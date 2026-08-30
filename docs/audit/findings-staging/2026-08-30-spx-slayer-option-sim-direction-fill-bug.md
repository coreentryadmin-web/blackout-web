## 2026-08-30 — [FINDING, P2 spx-slayer/research] `simulateOptionEntry`/`simulateOptionExit` conflate play direction with buy/sell, inflating simulated fills for every short-direction SPX Slayer play — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Found via targeted product-by-product audit (no live incident) of `src/features/spx/lib/playbook-option-sim.ts`. `simulateOptionEntry`/`simulateOptionExit` branch their adverse-fill formula on `input.direction` ("long"/"short") as if it meant buy vs. sell. |
| **Root cause** | `direction` here is the *play's* underlying stance (a long play expects a rally, a short expects a drop) — it is never buy/sell. SPX Slayer always **BUYS an option to enter** regardless of direction (a long play buys a call, a short play buys a put — confirmed via `spx-play-engine.ts`'s single `verdict: "APPROVE_BUY"`), and always **SELLS to close**, again regardless of direction. The old code did the opposite for "short": entry gave a fill *below* mid (as if selling) and exit gave a fill *above* mid (as if buying back). Live repro before the fix: `direction:"short"` entry on `option_mid=2.5` gave `assumed_fill=2.3925` instead of the correct `2.6075` (same as "long"); the corresponding exit gave `2.6075` instead of the correct `2.3925`. |
| **Why this matters** | This is the execution-cost model attached to every play's `option_ticket.execution_sim` for cost-adjusted P&L research (`playbook-option-execution-contract.ts`). For every short-direction play, the bug understated entry cost and overstated exit proceeds — i.e. it made every short play's simulated round-trip cost cheaper than a long play's, when the two should be identical (same buy-to-open/sell-to-close mechanics, same option, same spread). Any research or backtest comparing long vs. short-play cost/expectancy was silently biased in short plays' favor. |
| **Fix** | `simulateOptionEntry` now always applies the adverse-above-mid fill; `simulateOptionExit` now always applies the adverse-below-mid fill. Neither branches on `direction` anymore — the field stays in `OptionSimInput` for API stability but no longer affects the fill formula. |
| **Blast radius** | Single call site — `buildOptionExecutionSim` (same file) is the only caller of either function; no other consumer depends on the old (direction-branched) behavior. |
| **Why not caught earlier** | `playbook-option-sim.test.ts` only ever exercised `direction: "long"` — never `"short"` — so the reversed branch shipped with 0% coverage of the path it broke. |
| **Regression guard** | Two new tests in `playbook-option-sim.test.ts`: `simulateOptionEntry`'s short branch must equal its long branch (both pay adverse-above-mid); `simulateOptionExit`'s short branch must equal its long branch (both pay adverse-below-mid). |
| **Gates** | `npx tsc --noEmit` clean · `npx tsx --test playbook-option-sim.test.ts playbook-primary-score.test.ts` 9/9 pass · full `npm test` **11431 pass / 0 fail / 2 skipped** (Node 20.20.2). |
| **Status** | FIXED |

## 2026-08-30 — [FINDING, P3 spx-slayer/ranking] `rankPrimaryCandidates`' static-priority tie-break silently reversed priority order — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Found in the same audit pass, in `src/features/spx/lib/playbook-primary-score.ts`. The function's own doc comment says "Static priority is tie-break only" and `staticPriorityIndex` is documented as lower-index-wins ("lower index = higher priority" per its call site), but the tie-break sort put the *higher* index first. |
| **Root cause** | `static_priority_tiebreak: -tiebreak * 0.001` negated the index, then the sort (`a.static_priority_tiebreak - b.static_priority_tiebreak`, ascending) picked the smallest value first. Negating flips which candidate that is: for `tiebreak=1` (highest priority) vs `tiebreak=3`, the negated values are `-0.001` and `-0.003` — the sort picks `-0.003` (the LOWER-priority PB-03-style candidate) first. Live repro: PB-01 (priority index 3) and PB-14 (priority index 1) tied at `total=95` — PB-01 won the tie instead of PB-14. |
| **Why not caught earlier** | Both existing tests named around "tie-break" (`static priority tie-break only when totals match`, `sorts by total then static_priority_tiebreak`) actually construct candidates with UNEQUAL totals — one test's own comment says "not a static-order tie" — so neither ever exercised a genuine tie, and the reversed branch shipped untested. |
| **Fix** | Dropped the negation: `static_priority_tiebreak: tiebreak * 0.001`. The ascending sort now correctly puts the lowest (highest-priority) index first. |
| **Blast radius** | Single production usage (`rankPrimaryCandidates` itself); no other reader of `static_priority_tiebreak`'s sign. |
| **Regression guard** | New test picks PB-01 and PB-14 — same family (`reversal_failure`) and same fidelity (`high`), so with identical verdicts their pre-penalty totals are equal and the family-conflict penalty is 0 for both, producing a genuine tie — then asserts the lower priority index (1) outranks the higher one (3). |
| **Gates** | Same `npx tsc --noEmit` / `npx tsx --test` / full `npm test` run as above — both fixes landed together. |
| **Status** | FIXED |
