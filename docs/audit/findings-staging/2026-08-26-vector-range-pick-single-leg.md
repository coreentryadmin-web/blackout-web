> **kind:** `FINDING`

## Vector contract picks: a range play showed two opposite legs at the same conviction, both pinned to the chart's DTE toggle — FIXED

| **Status** | FIXED |
|---|---|

**Root cause 1 — same conviction on opposite directions.** `legsForBias("range")` priced BOTH a
call and a put, and `buildVectorContractPicks` labeled each with the play's own `conviction` — a
number that describes the PLAY as a whole ("price is range-bound, fade extremes"), not either
individual direction. A live member screenshot showed META's Suggested Play at RANGE/75%
producing "577.5C 08/26  75%" next to "565P 08/26  75%" — flagged by the member as nonsensical,
correctly: a call and a put cannot both have a 75% chance of the same outcome.

**Root cause 2 — both picks pinned to the chart's active DTE toggle.** The picker capped its
search to `horizonMaxDte(dteHorizon)`, the chart's currently-selected 0DTE/Weekly/Monthly walls
view. A member on the 0DTE view therefore always got a same-day contract regardless of what the
play actually called for — visible in the same screenshot (both picks "08/26", a same-day expiry)
and separately called out by the member ("does not have to be 0dte only").

**Evidence.** Both bugs reproduced directly from `vector-contract-picks.ts`'s prior logic:
`legsForBias` returned `["long","short"]` for range with no leg-selection step, and
`buildVectorContractPicks` threaded a `horizon: VectorDteHorizon` parameter straight into
`pickChainContract`'s `maxDte`.

**Fix.** `buildVectorContractPicks` now (1) collapses a range play to exactly ONE pick — whichever
leg's strike sits closer to spot right now, the more immediately actionable entry — and (2) no
longer accepts a horizon parameter at all; it always uses `pickChainContract`'s real "swing"
window (nearest liquid expiry, ≥2 calendar days out), independent of the chart's DTE toggle.
Threaded the removal through the API route (`contract-picks/route.ts`), `fetchVectorContractPicks`
(`src/lib/api.ts`), and `useVectorContractPicks`.

**Blast radius.** Same fix covers both symptoms in the same function — no other call sites read
`legsForBias`/`buildVectorContractPicks` outside this feature (shipped same-day in PR #2922).

**Fix rationale.** Considered keeping both range legs but relabeling the confidence display;
rejected because a member reads "confidence" as "chance this specific idea works" everywhere else
on the desk, and there's no honest way to show one number on two mutually-exclusive bets. Considered
scoring each leg independently (a real per-contract model); explicitly out of scope for this fix —
see the PR thread on #2924 for why an invented composite score is a bigger, separate problem this
fix does not attempt to solve.

**Test.** `vector-contract-picks.test.ts`: range now asserts exactly 1 pick (new fixture proves the
closer-to-spot leg wins over a farther one at the same conviction), the old same-day-expiry test
flipped to assert same-day is NEVER picked regardless of context, and a new test pins that the
picker no longer accepts a horizon argument. Full suite 10970/10970 pass, `tsc`/`build` clean.
