> **kind:** `FINDING`

## Vector 0DTE contract picks ignored targetStrike, collapsing distinct roles onto one contract — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `pickChainContract` (`src/features/nighthawk/lib/deterministic-edition.ts`) — Night
Hawk's own 0DTE contract picker, reused by Vector's `rankVectorPlayCandidates` for the "0dte" DTE
window — ranked every candidate purely by `dist: Math.abs(row.strike - spot)`. There was no way to
target a strike other than spot itself. Night Hawk's own callers never needed one (its 0DTE picks are
correctly ATM-nearest-to-spot by design), but Vector's role-specific specs
(`primary-long`/`primary-short` target a wall, `gex-king-pin` targets the GEX king strike,
`magnet-mean` targets a computed mean level) are supposed to each anchor to their own strike.
Because `pickChainContract` had no `targetStrike` parameter, every one of those specs collapsed onto
whichever 0DTE contract happened to be nearest **spot**, and the pick's "reason" text (built from the
spec's role/target) went on to describe a targeting relationship that never actually happened in the
picker.

**Evidence.** Before the fix: with spot=100, put wall=98, GEX king strike=95, and 0DTE rows at
strikes 98 and 95, both `primary-long` (should target the put wall, 98) and `gex-king-pin` (should
target the king strike, 95) picked the **same** contract — whichever was nearer spot (98) — because
`pickChainContract`'s distance calculation never saw either target strike. After the fix, they
correctly diverge: `primary-long` → strike 98, `gex-king-pin` → strike 95.

**Fix.** Added an optional 4th parameter, `targetStrike`, to `pickChainContract`. When present, the
per-row `dist` is computed against it instead of spot; when omitted (every Night Hawk call site),
behavior is byte-identical to before. Vector's 0DTE call site
(`vector-play-candidates.ts`'s `rankVectorPlayCandidates`) now passes `spec.targetStrike`.

**Blast radius.** `pickChainContract` has 5 call sites: 4 inside `deterministic-edition.ts` itself
(Night Hawk's own edition-building pipeline — `scored.direction`/`contrarian.direction` +
`params.maxDte`, no target-strike concept, all verified to still pass exactly 3 arguments and get
the unchanged spot-distance behavior) and 1 in Vector's `rankVectorPlayCandidates` (now updated).
`pickContractNearTarget` (the sibling function Vector already uses for weekly/monthly windows) was
unaffected — it already had a `targetStrike` parameter; only the 0DTE picker was missing it.

**What was deliberately left unchanged.** Night Hawk's own 0DTE contract selection is untouched — the
new parameter is optional and defaults to the exact prior behavior, verified by the full existing
`deterministic-edition.test.ts` suite (41/41 pass, unchanged assertions).

**Verification:** two new regression tests in `deterministic-edition.test.ts` (targetStrike ranks by
distance to that strike; two different target strikes pick different contracts) and one new test in
`vector-play-candidates.test.ts` (`primary-long` and `gex-king-pin` target their own strikes in the
0DTE window rather than collapsing). `tsc --noEmit` clean, full suite clean (11004 pass / 0 fail / 2
pre-existing skips), `npm run build` clean.
