## SPX Slayer: HELIX 0DTE sweep factor scored option TYPE alone — the same aggressor-direction bug already fixed in the sibling tape factor, reimplemented and still broken — FIXED

> **kind:** `FINDING`

Eighth product-surface pass in the "check product by product" audit sweep (SPX Slayer #3192 already fixed one bug; this is a second, deeper pass on the same surface).

| Field | Detail |
|---|---|
| **Symptom** | `scoreHelixFlowAlignment` (`src/features/spx/lib/spx-signals.ts`) — the "HELIX sweeps" factor, one of the largest single weights in the SPX confluence engine (±10/±15 on a scale whose action thresholds are ±22) — bucketed `desk.spx_flows` premium purely by `option_type`: every call print counted as bullish premium, every put print as bearish, regardless of who paid the spread. |
| **Root cause** | The function never read `f.ask_pct` (aggressor share), even though `SpxFlowBrief` carries it. This is the identical defect `spx-tape-direction.ts`'s own tape factor (`spxTapeSkew`) was specifically rewritten to eliminate — that file's header documents a measured 16.8% sign-flip rate between the type-only and aggressor-aware rules on the live tape. `scoreHelixFlowAlignment` reads the same `desk.spx_flows` array but was never updated to match; the fix (aggressor-awareness) landed in one function in this file and was never ported to its sibling. |
| **Why this matters** | A block of aggressively-SOLD 0DTE SPX calls — real, common price action — was scored as the desk's highest-conviction BULLISH signal (a sold call is bearish per the codebase's own already-shipped `flowDirection` rule), potentially tipping a marginal setup over the `BUY_CALL` threshold or into a higher confluence grade on flow that actually argued the opposite direction. |
| **Fix** | Replaced the manual option-type accumulation loop with `spxFlowSkew` (`spx-tape-direction.ts`) — the already-existing, already-tested shared helper that buckets a raw flow list by `flowDirection` (option type × aggressor side) and drops unreadable/typeless prints rather than guessing. Renamed `callPrem`/`putPrem` to `bullPrem`/`bearPrem` and updated the factor's detail text from "call/put sweeps dominant" to "bullish/bearish sweeps dominant" to match the new aggressor-aware framing. |
| **Blast radius** | Single function (`scoreHelixFlowAlignment`), single file. Golden-fixture test (`spx-signals.test.ts`) updated for the wording change only — the fixture's flows both happen to carry `ask_pct: 75` (bought), so the aggressor-aware rule agrees with the old type-only rule on direction/weight for that fixture; only the detail-text wording changed. |
| **Why not caught earlier** | The existing test fixture set `ask_pct: 75` on both its call and put sweep fixtures — bought in both cases — which happens to agree with the type-only reading either way, so the fixture could not distinguish the two rules. The same test-fixture-shape gap this session has already found in the Helix product surface. |
| **Regression guard** | New test: a $1.5M block of 0DTE SPX calls with `ask_pct: 20` (80% sold) must score the HELIX sweeps factor as **-15** (bearish), not +15. Confirmed **failing** against pre-fix code (`git stash` toggle: `15 !== -15`) and passing post-fix. |
| **Gates** | `npx tsc --noEmit` clean · `spx-signals.test.ts` 3/3 pass (Node 20.20.2) · full `npm test` — see PR. |
| **Status** | FIXED |
