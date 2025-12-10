import React, { useState, useEffect, useMemo } from "react";
import { Play, RefreshCw, Zap, Trophy, Shield, Dna, Copy, BarChart3, Clock, Target, Gauge, History, Table } from "lucide-react";

// FireBase Imports (Canvas Runtime Provided)
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, onSnapshot, collection, query, orderBy, getDocs } from 'firebase/firestore';

// Recharts Imports (for data visualization)
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

// CORE GAME CONSTANTS 
const TOTAL_SOLDIERS = 1000;
const NUM_STACKS = 10;
const GOLD_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // G1 to G10
const OPPONENT_POOL_SIZE = 200;
const TOTAL_BATTLES_IN_VALIDATION = 5 * OPPONENT_POOL_SIZE;
const MAX_POSSIBLE_GOLD_PER_BATTLE = GOLD_VALUES.reduce((a, b) => a + b, 0); // 55

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-blotto-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app;
let dbInstance = null;
let authInstance = null;
let currentUserId = null;

if (firebaseConfig) {
app = initializeApp(firebaseConfig);
dbInstance = getFirestore(app);
authInstance = getAuth(app);
}


/**
* Generates a random integer between min (inclusive) and max (inclusive).
*/
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
* Normalizes an array of numbers to sum exactly to TOTAL_SOLDIERS (1000).
*/
const normalizeAndFix = (arr) => {
let sum = arr.reduce((a, b) => a + b, 0);
if (sum === 0) return new Array(NUM_STACKS).fill(TOTAL_SOLDIERS / NUM_STACKS);

let alloc = arr.map(w => Math.floor((w / sum) * TOTAL_SOLDIERS));
let diff = TOTAL_SOLDIERS - alloc.reduce((a, b) => a + b, 0);

let attempts = 0;
while (diff !== 0 && attempts < TOTAL_SOLDIERS * 2) {
const i = randInt(0, NUM_STACKS - 1);
if (diff > 0) {
alloc[i]++;
diff--;
} else if (alloc[i] > 0) {
alloc[i]--;
diff++;
}
attempts++;
}
return alloc;
};

/**
* Forces all allocations to be odd numbers (>0) while maintaining the total sum for tie-breaker advantage.
*/
const enforceOddNumbers = (alloc) => {
let arr = [...alloc];
let sum = arr.reduce((a, b) => a + b, 0);
// Ensure we are working with a 1000-soldier budget
if (sum !== TOTAL_SOLDIERS) arr = normalizeAndFix(arr);

// Adjust non-zero even numbers to be odd
for (let i = 0; i < NUM_STACKS; i++) {
if (arr[i] > 0 && arr[i] % 2 === 0) {
// Try to subtract 1 to make it odd, or add 1 if it's currently > 1
arr[i] = Math.max(1, arr[i] - 1);
}
}

// Re-normalize the array to sum back to 1000
// This is done by distributing the difference (diff) while respecting the odd constraint
let diff = TOTAL_SOLDIERS - arr.reduce((a, b) => a + b, 0);

while (diff !== 0) {
const i = randInt(0, NUM_STACKS - 1);
if (diff > 0) {
// Need to add: always add 2 to maintain odd parity (or 1 if 0)
// If adding to a 0 stack, it becomes 1 (odd).
if (arr[i] === 0) {
arr[i] += 1;
diff -= 1;
} else {
arr[i] += 2;
diff -= 2;
}
} else {
// Need to subtract: subtract 2 to maintain odd parity (or 1 if it will go to 0)
if (arr[i] > 2) {
arr[i] -= 2;
diff += 2;
} else if (arr[i] === 1) {
arr[i] = 0;
diff += 1;
}
// If arr[i] is 2, it's even and should have been made odd, so this shouldn't happen often.
}
}

// Final check to ensure total is exactly 1000 and non-negative
return normalizeAndFix(arr.map(v => Math.max(0, v)));
};


// STRATEGIC ARCHETYPES FOR TRAINING (THE META-GAME)
const Archetypes = {
Proportional: () => normalizeAndFix(GOLD_VALUES),
SquareRoot: () => normalizeAndFix(GOLD_VALUES.map(Math.sqrt)),
TopHeavy: () => normalizeAndFix([5, 5, 5, 5, 10, 20, 50, 100, 250, 550]),
OddGamer: () => enforceOddNumbers(Archetypes.Proportional()),
WeightedRandom: () => normalizeAndFix(GOLD_VALUES.map(g => g * Math.random())),
EqualSplit: () => normalizeAndFix(new Array(NUM_STACKS).fill(100)),
InverseProportional: () => normalizeAndFix(GOLD_VALUES.map(g => 10 / g)),
ExtremeTop: () => normalizeAndFix([1, 1, 1, 1, 1, 1, 1, 10, 495, 495]),
// An approximation of the Nash Equilibrium allocation
NashApproximation: () => normalizeAndFix([1, 1, 1, 1, 10, 20, 40, 100, 400, 426]),
};

/**
* Builds a strategic opponent pool using stratified sampling to ensure balanced representation.
*/
const buildSmartOpponentPool = () => {
const pool = [];
const allArchetypeKeys = Object.keys(Archetypes);
const numArchetypes = allArchetypeKeys.length;
const perArchetype = Math.floor(OPPONENT_POOL_SIZE / numArchetypes);

// Guarantee each archetype appears at least 'perArchetype' times
allArchetypeKeys.forEach(key => {
for (let i = 0; i < perArchetype; i++) {
pool.push(Archetypes[key]());
}
});

// Fill remaining slots to reach exactly OPPONENT_POOL_SIZE
const remaining = OPPONENT_POOL_SIZE - pool.length;
for (let i = 0; i < remaining; i++) {
const key = allArchetypeKeys[randInt(0, numArchetypes - 1)];
pool.push(Archetypes[key]());
}

// 3. Shuffle the pool to ensure they are randomly encountered during fitness calculation
for (let i = pool.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[pool[i], pool[j]] = [pool[j], pool[i]];
}

return pool;
};

// GENETIC ALGORITHM OPERATORS

/**
* Generates the starting pool of strategies.
*/
const createInitialPopulation = (size) => {
const pop = [];
// Seed the initial population with diverse, proven archetypes
const baseKeys = ['Proportional', 'SquareRoot', 'OddGamer', 'NashApproximation', 'InverseProportional', 'TopHeavy'];
for (let i = 0; i < size; i++) {
const key = baseKeys[randInt(0, baseKeys.length - 1)];
let alloc = Archetypes[key]();
// Enforce odd numbers for tie-breaker advantage from the start
alloc = enforceOddNumbers(alloc);
pop.push({ alloc, fitness: 0, id: crypto.randomUUID() });
}
return pop;
};

/**
* Calculates the score (gold) gained by strategy 'my' against strategy 'opp'.
* Also updates the stackWin array if provided (used for visualization).
*/
const battle = (my, opp, stackWin = null) => {
let gold = 0;
for (let i = 0; i < NUM_STACKS; i++) {
// Win Condition: strictly more soldiers
if (my[i] > opp[i]) {
gold += GOLD_VALUES[i];
if (stackWin) {
stackWin[i] += GOLD_VALUES[i];
}
}
// Tie Condition: Equal soldiers, which is a loss (or 0 points)
// The GA's preference for odd numbers handles the tie-breaker subtly.
}
return gold;
};

/**
* Mutates a strategy by randomly moving soldiers between stacks.
*/
const mutate = (alloc, strength) => {
let next = [...alloc];
// Perform 5 random soldier transfers
for (let k = 0; k < 5; k++) {
const i = randInt(0, NUM_STACKS - 1); // Source stack
const j = randInt(0, NUM_STACKS - 1); // Destination stack
if (i === j) continue;

// Amount to move is controlled by dynamic strength
const amt = randInt(1, Math.floor(strength));
if (next[i] >= amt) {
next[i] -= amt;
next[j] += amt;
}
}
// Re-enforce the odd number constraint after mutation
return enforceOddNumbers(next);
};

/**
* Combines two parent strategies (P1 and P2) to create a child.
* Uses Single-Point Crossover.
*/
const crossover = (p1_alloc, p2_alloc) => {
// Crossover point is between 1 and 8 (exclusive of 0 and 9)
const split = randInt(1, NUM_STACKS - 2);
const childAlloc = [...p1_alloc.slice(0, split), ...p2_alloc.slice(split)];
// Normalization and odd-number enforcement ensure a valid new budget
return enforceOddNumbers(normalizeAndFix(childAlloc));
};

// CHART COMPONENTS 
const HistoryChart = ({ history }) => {
// Sort and limit history to the last 15 runs for a clear trend view
const data = useMemo(() => {
return history
.sort((a, b) => a.timestamp - b.timestamp)
.slice(-15)
.map((run, index) => ({
id: run.id,
run: index + 1,
// Primary line is AGPB
avgBattleGold: parseFloat(run.avgGoldPerBattle).toFixed(1),
// Tooltip data
train: run.trainingFitness,
validation: run.validationFitness,
stdDev: run.stdDev,
}));
}, [history]);

if (data.length === 0) {
return (
<div className="text-center py-10 text-slate-500 bg-white rounded-xl shadow-inner h-64 flex flex-col items-center justify-center">
<BarChart3 className="mx-auto mb-2" size={30}/>
<p className="text-lg font-semibold">Run the solver to start tracking history!</p>
<p className="text-sm">Runs are automatically saved to your user profile.</p>
</div>
);
}

// Max Y for AGPB is MAX_POSSIBLE_GOLD_PER_BATTLE (55)
const maxY = MAX_POSSIBLE_GOLD_PER_BATTLE * 1.05;

return (
<div className="h-64 bg-white p-4 rounded-xl shadow-lg border border-slate-200">
<ResponsiveContainer width="100%" height="100%">
<LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
<CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
<XAxis dataKey="run" label={{ value: 'Run Number', position: 'bottom', dy: 10, fill: '#475569' }} tickLine={false} axisLine={false}/>
<YAxis
domain={[0, maxY]}
label={{ value: 'Avg Gold Won / Battle', angle: -90, position: 'insideLeft', fill: '#475569' }}
tickFormatter={(value) => `${value}g`}
/>
<Tooltip
cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }}
content={({ active, payload, label }) => {
if (active && payload && payload.length) {
const runData = data.find(d => d.run === label);
if (!runData) return null;
return (
<div className="bg-white p-3 border rounded-lg shadow-xl text-sm">
<p className="font-bold text-slate-800 border-b pb-1 mb-1">Run {label}</p>
<p className="text-purple-600 font-semibold flex items-center gap-1"><Trophy size={14}/> AGPB: {runData.avgBattleGold}</p>
<p className="text-blue-600 flex items-center gap-1"><Dna size={14}/> Train Total: {runData.train}</p>
<p className="text-green-600 flex items-center gap-1"><Target size={14}/> Validation Total: {runData.validation}</p>
<p className="text-red-600 flex items-center gap-1"><Clock size={14}/> Stability (Std Dev): {runData.stdDev.toFixed(1)}</p>
</div>
);
}
return null;
}}
/>
<Legend verticalAlign="top" height={36} iconType="circle" />
<Line
type="monotone"
dataKey="avgBattleGold"
name="Avg Gold Per Battle (AGPB)"
stroke="#6366f1"
strokeWidth={3}
dot={{ r: 5, strokeWidth: 2, fill: '#6366f1', stroke: '#fff' }}
activeDot={{ r: 8, fill: '#fcd34d', stroke: '#6366f1' }}
/>
<Line
type="monotone"
dataKey="stdDev"
name="Standard Deviation (Stability)"
stroke="#f87171"
strokeWidth={1}
dot={{ r: 3, strokeWidth: 1, fill: '#f87171' }}
activeDot={{ r: 4 }}
/>
</LineChart>
</ResponsiveContainer>
</div>
);
};

const StackGoldBreakdownChart = ({ breakdownData }) => {
if (!breakdownData || breakdownData.length === 0) {
return (
<div className="text-center py-8 text-slate-500 bg-white rounded-xl shadow-inner h-64 flex flex-col items-center justify-center">
<Gauge className="mx-auto mb-2" size={30}/>
<p className="text-lg font-semibold">Gold Breakdown Visualization</p>
<p className="text-sm">This chart shows WHERE your soldiers won gold across the 10 stacks.</p>
</div>
);
}

const totalGoldWon = breakdownData.reduce((sum, d) => sum + d.goldWon, 0);

return (
<div className="h-64 bg-white p-4 rounded-xl shadow-lg border border-slate-200">
<ResponsiveContainer width="100%" height="100%">
<BarChart data={breakdownData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
<CartesianGrid strokeDasharray="3 3" stroke="#e0e7ff" />
<XAxis dataKey="stack" label={{ value: 'Stack Index (G1 to G10)', position: 'bottom', dy: 10, fill: '#475569' }} tickLine={false} axisLine={false}/>
<YAxis label={{ value: 'Gold Won (Sampled Total)', angle: -90, position: 'insideLeft', fill: '#475569' }} tickFormatter={(value) => `${value}g`}/>
<Tooltip
cursor={{ fill: 'rgba(253, 230, 138, 0.5)' }}
content={({ active, payload }) => {
if (active && payload && payload.length) {
const dataItem = payload[0].payload;
return (
<div className="bg-white p-3 border rounded-lg shadow-xl text-sm">
<p className="font-bold text-slate-800 border-b pb-1 mb-1">Stack {dataItem.stack} ({dataItem.goldValue} Gold Value)</p>
<p className="text-amber-600 font-semibold">Total Gold Won: {dataItem.goldWon}</p>
<p className="text-slate-500">Number of Wins: {Math.round(dataItem.goldWon / dataItem.goldValue)}</p>
</div>
);
}
return null;
}}
/>
<Legend content={() => <p className="text-center text-sm font-semibold text-slate-700">Total Gold Won in Sampled Battles: <span className="text-amber-600">{totalGoldWon}</span></p>} verticalAlign="top" height={36} />
<Bar dataKey="goldWon" fill="#f59e0b" name="Gold Won" radius={[4, 4, 0, 0]} />
</BarChart>
</ResponsiveContainer>
</div>
);
};

const HistoricalStrategiesTable = ({ history, copyToClipboard }) => {
// Sort by Avg Gold Per Battle descending for ranking
const sortedHistory = useMemo(() => {
return [...history].sort((a, b) => {
return (b.avgGoldPerBattle || 0) - (a.avgGoldPerBattle || 0);
});
}, [history]);

return (
<div className="mt-8">
<h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-slate-700 border-b pb-2"><History size={20}/> Historical Strategy Log ({history.length} Runs)</h2>
<div className="overflow-x-auto bg-white rounded-xl shadow-lg border border-slate-200">
<table className="min-w-full divide-y divide-slate-200">
<thead className="bg-slate-50">
<tr>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Rank</th>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Run #</th>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">AGPB <span className="text-purple-500">(Max 55)</span></th>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Stability (Std Dev)</th>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Validation Total</th>
<th className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Allocation</th>
</tr>
</thead>
<tbody className="bg-white divide-y divide-slate-200">
{sortedHistory.map((run, index) => (
<tr key={run.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50 hover:bg-slate-100 transition'}>
<td className="px-3 py-3 whitespace-nowrap text-sm font-extrabold text-blue-600">
{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
</td>
<td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-slate-900">
#{history.findIndex(h => h.id === run.id) + 1}
</td>
<td className="px-3 py-3 whitespace-nowrap text-sm text-purple-700 font-bold">
{(run.avgGoldPerBattle || 0).toFixed(2)}
</td>
<td className="px-3 py-3 whitespace-nowrap text-sm text-red-600">
{(run.stdDev || 0).toFixed(1)}
</td>
<td className="px-3 py-3 whitespace-nowrap text-sm text-green-600">
{run.validationFitness}
</td>
<td className="px-3 py-3 text-sm font-mono text-slate-700 max-w-xs overflow-hidden truncate flex items-center justify-between gap-2">
{run.allocation ? `[${run.allocation.slice(0, 4).join(", ")}... ]` : 'N/A'}
<button
onClick={() => copyToClipboard(`[${run.allocation.join(", ")}]`)}
className="text-blue-500 hover:text-blue-700 p-1 rounded transition bg-blue-100 hover:bg-blue-200 flex-shrink-0"
title="Copy Allocation Array"
>
<Copy size={14} />
</button>
</td>
</tr>
))}
</tbody>
</table>
</div>
</div>
);
}

// REACT COMPONENT
export default function App() {
const [running, setRunning] = useState(false);
const [gen, setGen] = useState(0);
const [best, setBest] = useState(null);
const [logs, setLogs] = useState(["Ready to start the simulation..."]);
const [gens, setGens] = useState(500); // Max Generations
const [mut, setMut] = useState(50); // Initial Mutation Strength
const [validationStats, setValidationStats] = useState(null);
const [history, setHistory] = useState([]); // Array of historical run data from Firestore
const [stackBreakdownData, setStackBreakdownData] = useState(null); // Data for Bar Chart
const [isAuthReady, setIsAuthReady] = useState(false); // Auth state flag

// Authentication and Firestore listener setup
useEffect(() => {
if (!authInstance || !dbInstance) {
setLogs(l => [...l, "FIREBASE ERROR: Configuration missing. History will not be saved."]);
return;
}

const signIn = async () => {
try {
// Sign in with custom token if available, otherwise anonymously
if (initialAuthToken) {
const userCredential = await signInWithCustomToken(authInstance, initialAuthToken);
currentUserId = userCredential.user.uid;
setLogs(l => [...l, "Signed in with custom token. User ID ready."]);
} else {
const userCredential = await signInAnonymously(authInstance);
currentUserId = userCredential.user.uid;
setLogs(l => [...l, "Signed in anonymously. User ID ready."]);
}
setIsAuthReady(true); // Set flag after successful auth
} catch (error) {
console.error("Auth error:", error);
setLogs(l => [...l, `Authentication failed: ${error.message}`]);
setIsAuthReady(true); // Still set ready to prevent infinite loading state
}
};
signIn();
}, []); // Run once on component mount

// Firestore listener for historical runs (depends on auth readiness)
useEffect(() => {
if (!isAuthReady || !dbInstance || !currentUserId) {
// Wait until auth is ready and we have instances/user ID
if (isAuthReady && !currentUserId) {
// This case should not happen if signIn is successful, but good for safety
setLogs(l => [...l, "Cannot load history: User ID missing after auth attempt."]);
}
return;
}

const runsCollectionRef = collection(dbInstance, `/artifacts/${appId}/users/${currentUserId}/blotto_runs`);
// Order by timestamp ascending for chart (Run 1, Run 2, ...)
const q = query(runsCollectionRef, orderBy("timestamp", "asc"));

const unsubscribe = onSnapshot(q, (snapshot) => {
const fetchedHistory = [];
snapshot.forEach((doc) => {
const data = doc.data();
fetchedHistory.push({
id: doc.id,
...data,
avgGoldPerBattle: data.avgGoldPerBattle || 0,
stdDev: data.stdDev || 0,
});
});
setHistory(fetchedHistory);
setLogs(l => [...l, `📊 Loaded ${fetchedHistory.length} historical runs.`]);

// Update the breakdown data from the LATEST run
const latestRun = fetchedHistory.slice(-1)[0];
if (latestRun && latestRun.goldBreakdown && Array.isArray(latestRun.goldBreakdown)) {
setStackBreakdownData(latestRun.goldBreakdown.map((goldWon, i) => ({
stack: i + 1,
goldValue: GOLD_VALUES[i],
goldWon: goldWon,
})));
}

}, (error) => {
console.error("Firestore listen error:", error);
setLogs(l => [...l, `Firestore listen error: ${error.message}`]);
});

return () => unsubscribe(); // Cleanup listener on unmount
}, [isAuthReady, dbInstance]); // Re-run when auth is ready or dbInstance changes

const sleep = ms => new Promise(r => setTimeout(r, ms));
const copyToClipboard = (text) => {
const tempElement = document.createElement('textarea');
tempElement.value = text;
document.body.appendChild(tempElement);
tempElement.select();
// document.execCommand('copy') is used for compatibility in iframes
document.execCommand('copy');
document.body.removeChild(tempElement);
setLogs(l => [...l, "Clipboard: Allocation array copied!"]);
};

const runGA = async () => {
if (running) return;
setRunning(true);
setValidationStats(null);
setStackBreakdownData(null);
setLogs(["Starting simulation...", `Building stratified training pool of ${OPPONENT_POOL_SIZE} strategies...`]);
setBest(null);
setGen(0);

const POP_SIZE = 200;
const ELITE_COUNT = 30;
const MAX_GENERATIONS = gens; // Use state value

const opponents = buildSmartOpponentPool();
let pop = createInitialPopulation(POP_SIZE);
let bestFitnessEver = 0;

for (let g = 0; g < MAX_GENERATIONS; g++) {
// Calculate Fitness
pop.forEach(ind => {
let totalGold = 0;
opponents.forEach(opp => totalGold += battle(ind.alloc, opp));
ind.fitness = totalGold;
});

// Sort by Fitness
pop.sort((a, b) => b.fitness - a.fitness);

// Update best individual
if (pop[0].fitness > bestFitnessEver) {
bestFitnessEver = pop[0].fitness;
setBest(pop[0]);
}

// Selection (Elitism)
const nextGeneration = pop.slice(0, ELITE_COUNT);
// Dynamic decay of mutation strength (from 'mut' down to 5)
const currentMutationStrength = Math.max(5, mut * (1 - g / MAX_GENERATIONS));
// Dynamic decay of crossover rate (from 80% down to 20%)
const currentCrossoverRate = Math.max(0.2, 0.8 * (1 - g / MAX_GENERATIONS));

// Reproduction
while (nextGeneration.length < POP_SIZE) {
// Select parents via Tournament or simple random (here, top half random)
const p1 = pop[randInt(0, POP_SIZE / 2)];
let childAlloc = p1.alloc.slice(); // Copy P1 as base

if (Math.random() < currentCrossoverRate) {
const p2 = pop[randInt(0, POP_SIZE / 2)];
childAlloc = crossover(p1.alloc, p2.alloc);
}

const finalChildAlloc = mutate(childAlloc, currentMutationStrength);
nextGeneration.push({ alloc: finalChildAlloc, fitness: 0, id: crypto.randomUUID() });
}

pop = nextGeneration;

if (g % 5 === 0) {
// Use a small sleep to yield control back to the UI thread for updates
setGen(g);
await sleep(10);
}
}

// Final update after loop completes
setGen(MAX_GENERATIONS);
setBest(pop[0]);

// FINAL VALIDATION PHASE
setLogs(l => [...l, `Running Multi-Round Validation Test`]);
await sleep(100);

let totalValidationScore = 0;
const validationScores = [];
const numValidationRounds = 5;
const finalBestAlloc = pop[0].alloc;
// Run against 5 completely new, stratified opponent pools
for (let r = 0; r < numValidationRounds; r++) {
setLogs(l => [...l, `Testing against NEW stratified pool (Round ${r + 1} of ${numValidationRounds})...`]);
await sleep(50);
const newOpponents = buildSmartOpponentPool();
let roundScore = 0;
newOpponents.forEach(opp => roundScore += battle(finalBestAlloc, opp));
validationScores.push(roundScore);
totalValidationScore += roundScore;
}

// Calculate Stats
const avgValidationScore = Math.floor(totalValidationScore / numValidationRounds);
const minValidation = Math.min(...validationScores);
const maxValidation = Math.max(...validationScores);
const variance = validationScores.reduce((sum, s) => sum + Math.pow(s - avgValidationScore, 2), 0) / numValidationRounds;
const stdDev = Math.sqrt(variance);
// AGPB is total gold won divided by the total number of validation battles (5 * 200 = 1000)
const avgGoldPerBattle = (totalValidationScore / TOTAL_BATTLES_IN_VALIDATION).toFixed(2);

const stats = {
avg: avgValidationScore,
min: minValidation,
max: maxValidation,
stdDev: stdDev,
avgBattleGold: parseFloat(avgGoldPerBattle)
};
setValidationStats(stats);
setLogs(l => [...l, `Final convergence achieved after ${MAX_GENERATIONS} generations.`]);
setLogs(l => [...l, `Average Validation Fitness (Total Gold): ${stats.avg}`]);
setLogs(l => [...l, `Average Gold Per Battle (AGPB): ${avgGoldPerBattle}`]);
setLogs(l => [...l, "---"]);

// Calculate Gold Breakdown (for the second graph)
const goldBreakdown = new Array(NUM_STACKS).fill(0);
const breakdownOpponents = buildSmartOpponentPool();
// Test against one fresh pool of 200 to get a representative breakdown
breakdownOpponents.forEach(opp => {
battle(finalBestAlloc, opp, goldBreakdown); // Use the modified battle function
});
const breakdownData = goldBreakdown.map((goldWon, i) => ({
stack: i + 1,
goldValue: GOLD_VALUES[i],
goldWon: goldWon,
}));
setStackBreakdownData(breakdownData);

// SAVE TO FIRESTORE
if (dbInstance && currentUserId) {
try {
const runData = {
timestamp: Date.now(),
trainingFitness: pop[0].fitness,
validationFitness: stats.avg,
minValidation: stats.min,
maxValidation: stats.max,
stdDev: stats.stdDev,
avgGoldPerBattle: stats.avgBattleGold,
allocation: pop[0].alloc,
generations: MAX_GENERATIONS,
opponentPoolSize: OPPONENT_POOL_SIZE,
goldBreakdown: goldBreakdown,
};
const runsCollectionRef = collection(dbInstance, `/artifacts/${appId}/users/${currentUserId}/blotto_runs`);
await addDoc(runsCollectionRef, runData);
setLogs(l => [...l, "💾 Run results saved to history."]);
} catch (error) {
console.error("Firestore save error:", error);
setLogs(l => [...l, `Error saving run history: ${error.message}`]);
}
} else {
setLogs(l => [...l, "Cannot save history: Firebase not initialized or user ID missing."]);
}

setLogs(l => [...l, "Recommended Submission: Click the array above to copy."]);
setRunning(false);
};

return (
<div className="p-4 sm:p-8 max-w-5xl mx-auto font-[Inter] bg-slate-50 min-h-screen">
<div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl border border-blue-100">

<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b pb-4">
<h1 className="text-2xl sm:text-3xl font-extrabold flex items-center gap-3 text-slate-800">
<Shield className="text-blue-600 size-7 stroke-2"/> Blotto One-Shot GA Solver
</h1>
<button
onClick={runGA}
disabled={running}
className={`mt-4 sm:mt-0 px-6 py-3 rounded-xl text-white font-bold flex items-center gap-2 transition duration-300 shadow-xl ${running ? "bg-slate-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transform"}`}
>
{running ? <RefreshCw className="animate-spin size-5"/> : <Play className="size-5 fill-white"/>}
{running ? `Running (Gen ${gen} / ${gens})...` : "Run Simulation"}
</button>
</div>

{/* Historical Charting Area (Graph 1: AGPB Trend) */}
<h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-slate-700 border-b pb-2"><BarChart3 size={20}/> Performance Trend (Avg Gold Per Battle)</h2>
<HistoryChart history={history} />
{/* Configuration and Result Grid */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
{/* Settings Column */}
<div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner">
<h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-slate-700"><Zap size={18}/> Optimization Settings</h2>
<label className="block text-sm font-semibold text-slate-600 mb-1">Generations (Gens)</label>
<input
type="number"
value={gens}
onChange={e => setGens(Number(e.target.value))}
className="w-full p-2 rounded-lg border border-slate-300 mb-4 focus:ring-blue-500 focus:border-blue-500 transition shadow-sm"
min="100" max="1000" step="50"
/>
<p className="text-xs text-slate-500 mb-4">Recommended: 400-500 for robust convergence against the diverse opponent pool.</p>

<label className="block text-sm font-semibold text-slate-600 mb-1">Initial Mutation Strength</label>
<div className="flex items-center gap-3 mb-2">
<input
type="range"
min="10" max="100"
value={mut}
onChange={e => setMut(Number(e.target.value))}
className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer range-lg"
/>
<span className="text-base font-bold text-blue-600 w-10 text-right">{mut}</span>
</div>
<div className="flex justify-between text-xs text-slate-500 mt-1">
<span>(High Exploration)</span>
<span>(Decays to 5 over generations)</span>
</div>
</div>

{/* Best Strategy Result */}
<div className="md:col-span-2 bg-blue-50 border border-blue-300 p-6 rounded-xl relative flex flex-col justify-between min-h-[300px] shadow-lg">
{!best ? (
<div className="flex flex-col items-center justify-center text-blue-400 h-full py-10">
<Dna size={48} className="mb-3 opacity-60"/>
<p className="text-xl font-semibold">Ready to Find the Nash Strategy</p>
<p className="text-sm text-blue-500">The GA evolves solutions over many generations by battling diverse archetypes.</p>
</div>
) : (
<>
<div className="flex justify-between items-start mb-4 pb-2 border-b border-blue-200">
<h2 className="text-xl font-bold text-blue-900 flex items-center gap-2">
<Trophy className="text-amber-500 fill-amber-500 size-6"/> Best Submission Strategy
</h2>
<div className="flex flex-col items-end gap-1 text-sm">
{validationStats !== null && (
<span className="font-mono text-purple-800 bg-purple-100 px-3 py-1 rounded-full shadow-md flex items-center gap-1 font-extrabold text-lg" title="Average Gold Won Per Battle (Max 55)">
<Target className="size-4"/> AGPB: {validationStats.avgBattleGold}
</span>
)}
{validationStats !== null && (
<span className="text-xs font-mono text-red-700 bg-red-100 px-2 py-0.5 rounded-full shadow-inner flex items-center gap-1" title="Standard Deviation (Lower is more consistent)">
<Clock size={12}/> Std Dev: {validationStats.stdDev.toFixed(1)}
</span>
)}
<span className="font-mono text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full shadow-inner text-xs mt-1" title="Fitness calculated against training pool">
Train Total: {best.fitness}
</span>
</div>
</div>

{/* Allocation Visualizer */}
<div className="grid grid-cols-5 md:grid-cols-10 gap-2 mb-4">
{best.alloc.map((v, i) => (
<div
key={i}
className={`bg-white p-2 border rounded-xl text-center shadow transition hover:shadow-lg hover:scale-[1.03] transform ${v % 2 !== 0 && v > 0 ? 'border-green-500 bg-green-50' : 'border-slate-200'}`}
title={v % 2 !== 0 && v > 0 ? "Odd allocation (Tie-breaker advantage)" : "Even or Zero allocation"}
>
<div className="text-[10px] text-slate-400 font-medium">G{i + 1} ({GOLD_VALUES[i]}g)</div>
<div className="font-extrabold text-lg text-slate-900 leading-none">{v}</div>
</div>
))}
</div>

{/* Submission Array */}
<div
className="bg-white p-4 rounded-xl border border-blue-400 font-mono text-sm break-all cursor-pointer select-none flex justify-between items-center transition hover:bg-blue-100 shadow-md"
onClick={() => copyToClipboard(`[${best.alloc.join(", ")}]`)}
>
<span className="break-all">{`[${best.alloc.join(", ")}]`}</span>
<Copy className="size-4 ml-3 text-blue-600 flex-shrink-0"/>
</div>
<div className="text-xs text-center text-blue-600 mt-1 font-semibold">
<span className="bg-blue-100 px-2 py-0.5 rounded-lg shadow-sm">Click on the array above to instantly copy the optimized strategy.</span>
</div>
</>
)}
</div>
</div>

{/* Stack Gold Breakdown Chart (Graph 2: WHERE the gold was won) */}
<h2 className="text-xl font-bold mb-3 mt-8 flex items-center gap-2 text-slate-700 border-b pb-2"><Gauge size={20}/> Gold Breakdown Per Stack (Latest Run)</h2>
<StackGoldBreakdownChart breakdownData={stackBreakdownData} />

{/* Console Log */}
<h2 className="font-bold text-xl mb-2 mt-8 flex items-center gap-2 text-slate-700"><Dna size={18}/> GA Console</h2>
<div className="bg-slate-900 text-green-400 font-mono text-xs p-3 rounded-lg h-40 overflow-y-auto border border-slate-700 shadow-inner">
{logs.map((l, i) => (<div key={i} className="leading-5 whitespace-pre-wrap">&gt; {l}</div>))}
{running && <div className="animate-pulse text-yellow-400 leading-5">&gt; Calculating... Please wait for convergence.</div>}
</div>
{/* Historical Strategies Table */}
<HistoricalStrategiesTable history={history} copyToClipboard={copyToClipboard} />
</div>
</div>
);
}