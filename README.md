# Blotto One-Shot Genetic Algorithm (GA) Solver

This repository hosts a sophisticated React component that implements a **Genetic Algorithm (GA)** to find an optimal troop allocation strategy for a variant of the classic **Colonel Blotto Game**.

The solver aims to converge towards a robust, near-Nash Equilibrium strategy by testing candidate allocations against a diverse, stratified pool of strategic opponent archetypes.

## The Colonel Blotto Game

The game involves allocating a fixed number of soldiers across multiple, independent battlefields.

| Component | Description | Value |
| :--- | :--- | :--- |
| **Total Soldiers** | The total budget for troop allocation. | 1000 |
| **Number of Stacks** | The number of independent battlefields (stacks). | 10 (G1 to G10) |
| **Gold Values** | The gold won for capturing stack $i$. | $G = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]$ |
| **Win Condition** | The player with **strictly more** soldiers on a stack wins that stack's gold value. |
| **Tie Condition** | A tie (equal soldiers) results in **zero gold** for both players on that stack. |
| **Max Gold** | Maximum possible gold won in a single battle. | 55 (sum of gold values) |

The goal is to find an allocation $\mathbf{a} = [a_1, a_2, ..., a_{10}]$ such that $\sum a_i = 1000$ and $a_i \ge 0$, which maximizes the **Average Gold Per Battle (AGPB)** against a diverse meta-game.



## Core Features & Optimizations

* **Genetic Algorithm Core:** Implements selection (elitism), single-point crossover, and mutation for strategy evolution.
* **Stratified Opponent Pool:** Uses **9 predefined strategic *Archetypes*** (e.g., `Proportional`, `TopHeavy`, `NashApproximation`) to build a balanced training pool of **200 opponents**, ensuring robust generalization.
* **Odd-Number Enforcement Heuristic:** A custom normalization function (`enforceOddNumbers`) adjusts non-zero soldier counts to be odd wherever possible. Since ties result in 0 gold, an odd allocation on a stack is a powerful tie-breaker mechanism to guarantee a win if the opponent uses an even number one soldier less than you.
* **Dynamic GA Parameters:** Mutation strength and crossover rate decay over generations, promoting early exploration and later fine-tuning/convergence.
* **Multi-Round Validation:** The final best strategy is tested against **5 completely new, fresh opponent pools** to assess its true performance, consistency, and **stability** (measured by **Standard Deviation**).
* **Historical Tracking:** Integrates with **Firebase Firestore** (via the Canvas runtime environment) to save run history, allowing users to track their best strategies and performance trends.
* **Data Visualization:** Uses `recharts` to display the AGPB performance trend and a breakdown of gold won per stack.

## Key Algorithm Mechanics

### 1. Fitness Calculation (`battle` function)

The fitness of a strategy is the total gold won across all battles in the training pool.

$$
\text{Fitness}(\mathbf{a}) = \sum_{k=1}^{\text{Pool Size}} \left( \sum_{i=1}^{10} G_i \cdot \mathbb{I}(a_i > o_{k,i}) \right)
$$

Where:
* $G_i$ is the gold value of stack $i$.
* $\mathbf{a} = [a_1, ..., a_{10}]$ is the candidate strategy allocation.
* $\mathbf{o}_k = [o_{k,1}, ..., o_{k,10}]$ is the $k$-th opponent's allocation.
* $\mathbb{I}(\cdot)$ is the indicator function (1 if true, 0 if false).

### 2. Strategic Archetypes (Training Meta)

The `Archetypes` object defines the specific strategies used to create the diverse opponent pool:

* `Proportional`
* `SquareRoot`
* `TopHeavy`
* `OddGamer`
* `WeightedRandom`
* `EqualSplit`
* `InverseProportional`
* `ExtremeTop`
* `NashApproximation`

### Allocation Constraints

The following functions ensure a valid and optimized strategy is maintained throughout the GA lifecycle:

| Function | Purpose |
| :--- | :--- |
| `normalizeAndFix` | Ensures the soldier sum is exactly 1000. |
| `enforceOddNumbers` | Adjusts non-zero, even-numbered stacks to be odd to minimize ties, then re-normalizes the total. |

## Running the Solver

1.  **Adjust Settings (Optional):** Modify **Generations** (default: 500) and **Initial Mutation Strength** (default: 50) in the settings panel to balance run time and convergence stability.
2.  **Start:** Click **"Run Simulation"**.
3.  **Monitor:** Watch the **GA Console** for progress updates and the **Performance Trend** chart for convergence.
4.  **Result:** Upon completion, the **Best Submission Strategy** will display the optimal allocation and its key validation metrics:
    * **AGPB (Avg Gold Per Battle):** The primary performance score (Max 55).
    * **Std Dev (Standard Deviation):** Measures the stability/consistency of the strategy across multiple validation rounds (lower is better).

The final allocation array can be copied directly from the result box for submission or use.

---

## License

This project is open-source and available under the MIT License.

### The MIT License (MIT)

Copyright (c) [2025] [Hannah Friedman]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
