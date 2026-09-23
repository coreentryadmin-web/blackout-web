## `troughPremium` rounded at 2dp while its sibling `mid`/`peakPremium` were 4dp-overridden — a real trough could read ABOVE the current mark — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings — Ask Largo (standing mandate) |
| **Severity** | P3 (member-facing numeric-display inconsistency; no data corruption, no financial-math error) |
| **Files** | `src/app/api/market/nighthawk/horizons/route.ts` |

### Root cause

`GET /api/market/nighthawk/horizons`'s `roundFloats(...)` call carries a `keyDp` override map so
option-premium fields that routinely price sub-$1 (Banger-origin penny positions) don't get
destroyed by the plain 2dp default — `mid`, `entryPremium`, and `peakPremium` were already in that
map. `troughPremium` (the position's LEAST mark ever observed, latched via
`updateBangerLiveState`'s `LEAST(...)` SQL) was never added, so it fell through to the 2dp default
while its siblings stayed at 4dp.

For a contract trading in the $0.30s, that precision mismatch is large enough to invert the
displayed relationship: a genuinely honest trough tick can round UP past a mid/peak that stayed
essentially unrounded at 4dp — producing a trough that reads as HIGHER than the current mark, which
is definitionally impossible (a trough is the lowest value ever observed, so it can never exceed
any later mark, including the current one).

### Evidence

Found live 2026-09-23 auditing a pure Banger-origin swing play (BKKT, `SWING:BKKT:1310`) via
`GET /api/market/nighthawk/horizons?view=swings`: `peakPremium: 0.325`, `troughPremium: 0.33`,
`contract.mid: 0.325` — the trough read literally above the current mark. Widened the check across
every open Banger-origin position on the live board (78 checked): **6 carried the same violation**
(`mid < troughPremium` by a small, roughly-constant gap), e.g. REPL (mid 0.525, trough 0.53), MRNA
(mid 5.975, trough 5.98), ARKG (mid 0.225, trough 0.23) — the shape is consistent across every
instance: real trough values a few thousandths above their own true value, rounded up past a mid
that never got the same treatment.

### Fix

Added `troughPremium: 4` to the same `keyDp` override map that already covers `mid`/`entryPremium`/
`peakPremium`/`gamma`/`theta`/`vega`/`iv`. One-line change, no schema/data change — the underlying
`trough_premium` DB column and the `updateBangerLiveState` `LEAST(...)` latch were already correct;
only the response-boundary rounding was wrong.

### Evidence (tests)

RED→GREEN proven via `git stash` (test file kept, implementation reverted): the new test failed
pre-fix with the exact live-repro shape (a real trough of 0.326 rounding to 0.33, landing above a
mid of 0.329), passed post-fix. `src/app/api/market/nighthawk/horizons/route.test.ts`: 8/8 pass
(6 pre-existing unchanged + 1 pre-existing gamma/theta/vega/iv test + the new trough test — fixture
picked so the RAW trough is honestly below mid, isolating the rounding-precision bug from a
data-correctness question). `tsc --noEmit`: clean. Full `npm test`: 15336/15339 pass, 0 fail, 3
pre-existing/unrelated skips.

### Fix rationale

Followed the exact precedent this same file's comment block already documents for gamma/theta/vega/
iv ("once a payload mixes scales, every fractional-scale field in that family should share the
override rather than re-discovering the bug field-by-field") — `troughPremium` is `peakPremium`'s
direct sibling (same DB row, same unit, same latching mechanism, mirrored GREATEST/LEAST pair), so
it belongs in the same override for the same reason. No other route was touched: `play-brief/route.ts`
and `swing/record/route.ts` were checked and don't expose raw `troughPremium` through their own
`roundFloats()` calls in a way that reproduces this symptom (the play-brief narrative renders
trough as a pre-computed percentage string, not this raw dollar field) — a genuinely separate
finding if one ever surfaces there, not something this fix should speculatively widen to cover.
