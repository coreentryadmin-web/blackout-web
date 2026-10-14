> **kind:** FINDING

## SPX Slayer desk: a broken prior-day high/low keeps its hardcoded "resistance"/"support" label even after price trades through it, feeding wrong structure confirmations into real play logic — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `buildLevels()` (`src/features/spx/lib/spx-desk-levels.ts`) assigns every desk
level a `kind` ("support"/"resistance"/"neutral") as a hardcoded per-label constant: `PDH` is
always `"resistance"`, `PDL` is always `"support"`, regardless of where price currently sits
relative to them. That is correct for `HOD`/`LOD` — today's own session high/low are
tautologically bounded by today's own price (price can never trade below LOD or above HOD), so
their kind can never actually invert. It is NOT correct for `PDH`/`PDL` — these are PRIOR-session
reference levels, and price is free to gap or trend through either of them. Once price has
genuinely traded through a prior-day level, that level's real role inverts (an old high broken
from below becomes support underneath; an old low broken from above becomes resistance overhead),
exactly the "role reversal" `#80` already partially addressed for the GEX King node by marking it
neutral rather than hardcoding a direction (see that fix's own comment in the same file). PDH/PDL
never got the equivalent treatment, and — unlike the King node — their correct role IS computable
once you know which side of the level price is on, so this fix computes it instead of assuming
the common "price inside yesterday's range" case.

**Evidence.** Live `GET /api/market/spx/desk` (2026-10-14 ~21:32 UTC, after-hours/extended
session, this cycle's standing SPX-desk coherence check): `price: 7718.94`, `pdh: 7814.15`,
`pdl: 7786.11` — a genuine breakdown day where price sits BELOW the entire prior session's range
(both PDH and PDL above spot). The served `levels` array included:

```json
{ "label": "PDL", "value": 7786.11, "kind": "support", "distance_pct": 0.87 }
```

PDL sits 67.17 points (0.87%) ABOVE price, i.e. broken-through overhead resistance — yet it was
labeled `"support"`, the opposite of its actual current role. `HOD`/`PDH` (also above price)
correctly read `"resistance"` in the same payload, and `LOD` (below price, tautologically) correctly
read `"support"` — only `PDL` was wrong, because it is the one label whose hardcoded assumption
("PDL sits below price") had actually been violated that session.

Confirmed in the existing test suite that this was never covered: `spx-desk-levels.test.ts`'s only
fixture before this fix (`LEVELS_INPUT`) has `price: 7428.78` strictly between `pdl: 7405` and
`pdh: 7435` — the common, in-range case — so the PDH/PDL-outside-range scenario had no regression
test at all.

**Why this is not cosmetic — blast radius into real play logic.** `l.kind === "support"` /
`"resistance"` is read directly by two live SPX Slayer play-generation call sites, not just display:
- `src/features/spx/lib/spx-play-confirmations.ts`'s `structureAligned()`: `supports = (desk.levels
  ?? []).filter(l => l.kind === "support")`, then `atSupport = supports.some(l => nearLevel(price,
  l.value))` — within `playStructureProximityPts()` (10pts) of a mislabeled PDL, this reads "Long
  near PDL support" and PASSES the long structural confirmation off a level that is, in fact,
  overhead resistance the price had just broken down through (the mirror bug applies to a
  broken-out PDH for short confirmations).
- `src/features/spx/lib/spx-play-mtf.ts`'s `keyLevelForDirection()`: falls back to `desk.levels
  ?.find(l => l.kind === "support")?.value` as the long MTF trigger anchor whenever `desk.vwap` is
  null (a real, if less common, desk state) — same wrong-level risk.

Dormant in this exact snapshot only because PDL's 67pt distance exceeds the 10pt proximity gate and
`vwap` was non-null, not because the underlying logic was safe — the bug activates on any session
where price later drifts back within 10pts of the broken level, or where `vwap` is temporarily
unavailable.

**Fix.** Added `priorSessionLevelKind(value, price, fallback)` — `price >= value ? "support" :
"resistance"` — and used it for `PDH`/`PDL` only; `HOD`/`LOD` keep their unconditional hardcoded
kind (correct by construction, no fix needed there) and every neutral-kind level (`King node`,
`Max Pain`, `γ Flip`, EMAs/SMAs, `VWAP`) is untouched. The common in-range case is unaffected by
construction (`price >= pdl` is true when price is inside yesterday's range, same as the old
hardcoded `"support"`; `price >= pdh` is false in-range, same as the old hardcoded `"resistance"`)
— confirmed by the pre-existing `LEVELS_INPUT` fixture test still passing unchanged.

**Fix rationale.** Considered marking PDH/PDL neutral instead (the King node's treatment) but
rejected it: unlike the King node (whose role genuinely depends on dealer positioning the desk
cannot cheaply classify), a prior-session level's role IS fully determined by price's current side
of it — computing the correct answer is strictly better than discarding the signal to neutral, and
preserves the existing "support"/"resistance" semantics every consumer (`structureAligned`,
`keyLevelForDirection`, the rendered level ladder) already expects. `HOD`/`LOD` were deliberately
left hardcoded rather than "fixed" the same way — they cannot actually invert, so applying the same
dynamic check would be inert complexity with no behavior change, confirmed by re-reading
`sessionHodLod`-style construction: today's own price is always within `[lod, hod]` by definition.

**Tests.** `src/features/spx/lib/spx-desk-levels.test.ts`: renamed the existing in-range test to
clarify its scope, and added two new regression tests — a breakdown case (PDL above price, both
PDH/PDL above price) asserting `PDL -> "resistance"`, `PDH -> "resistance"` (unchanged), `HOD ->
"resistance"`, `LOD -> "support"`; and the mirror breakout case (PDH/PDL both below price) asserting
`PDH -> "support"`, `PDL -> "support"`. RED→GREEN proven via `git stash push -u --
spx-desk-levels.ts`: pre-fix, the two new tests failed (`PDL` read `"support"` expected
`"resistance"`; `PDH` read `"resistance"` expected `"support"`); post-fix (stash pop), 6/6 pass.
Full collateral run (`spx-desk-levels.test.ts` + `spx-desk-merge.test.ts` +
`spx-play-confirmations.test.ts` + `spx-signals.test.ts` + `spx-play-engine.test.ts`): 32 + 3 + 5 =
all green, 0 fail. `npx tsc --noEmit` clean on Node 20.
