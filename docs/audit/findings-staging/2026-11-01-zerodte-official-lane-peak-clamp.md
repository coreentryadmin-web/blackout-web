> **kind:** FINDING

## 0DTE record: `officialOverridingRealExit` served `plan_pnl_pct` RAW, unclamped against its own peak — the 2026-10-31 clamp fix's blast radius missed this sibling lane — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-60 live audit (2026-11-01, `check:zerodte` agent), per the
standing 5-engine live monitor mandate. Cross-checked against
`GET /api/market/zerodte/record?days=90` (production): 8 real rows currently violate
`plan_pnl_pct <= max_favorable_pct` — a mathematical impossibility, since `max_favorable_pct`
(`peak_pnl_pct`) is, by definition, the highest this exact position ever reached before it closed.

**Root cause:** `src/lib/zerodte/record.ts` has two sibling functions that both compute the
"official" P&L off the SAME frozen `entry_context.exit` blob for the same rows, but only one of
them was clamped:
- `managedGradeView()` (the member-facing AS-MANAGED number, line ~556) correctly clamps a
  live-only engine exit's `pnl_pct` to the row's own `peak_pnl_pct` via `clampManagedPnlToPeak()`
  (line ~515) — added 2026-10-31 for exactly this "a position can never realize better than its
  own recorded peak" reason, after a live audit found 7 frozen pre-2026-09-04 rows where
  `managed_pnl_pct` exceeded `max_favorable_pct`.
- `officialOverridingRealExit()` (line ~201) — the sibling function that computes the
  "official"/calibration `plan_pnl_pct`/`plan_outcome` whenever a real, live-only exit
  (thesis_break/ratchet/flat) outranks a GENUINE WS-11 trim-scale reconstruction — read
  `exit.pnl_pct` RAW, with **no clamp at all**, and returned `plan_pnl_pct: round2(exit.pnl_pct)`.

Both functions read the identical `entry_context.exit` blob (via `readManagedExit`) for the exact
same rows whenever `officialOverridingRealExit`'s own precedence fires (a real exit whose reason
the bar-walk reconstruction cannot faithfully reproduce, per `realExitIsBarWalkReproducible`,
outranking a genuine 2+-tranche reconstruction). The 2026-10-31 fix patched `managedGradeView()`'s
own inline clamp but never touched this sibling function that reads the same frozen data for the
same rows — so for any row that both (a) carries a genuine reconstruction AND (b) has a real exit
outranking it AND (c) that real exit's raw `pnl_pct` exceeds its own `peak_pnl_pct`, the two
"official" numbers for one position disagreed: `managed_pnl_pct` was correctly clamped while
`plan_pnl_pct` was not.

**Live evidence (production, `GET /api/market/zerodte/record?days=90`, 2026-11-01) — 8 real rows
currently violate `plan_pnl_pct <= max_favorable_pct`** (ticker, date — exit pnl / peak pnl /
buggy `plan_pnl_pct` / correct clamped value):
- CRCL 2026-09-03 — 0 / -0.22 / 0 / -0.22
- AAPL 2026-09-01 — 0 / -0.24 / 0 / -0.24
- CRCL 2026-08-19 — 27.07 / 26.88 / 27.07 / 26.88
- HIMS 2026-08-19 — 5.68 / 5.11 / 5.68 / 5.11
- KORU 2026-08-13 — -2.5 / -3.13 / -2.5 / -3.13
- SPCH 2026-08-12 — 11.63 / 10.47 / 11.63 / 10.47
- RIOT 2026-08-11 — 0 / -0.54 / 0 / -0.54
- FIG 2026-08-10 — 1.04 / 0.52 / 1.04 / 0.52

5 of these (HIMS/KORU/SPCH/RIOT/FIG) are the EXACT rows the 2026-10-31 fix's own PR already named
as fixed for `managed_pnl_pct` — direct proof that fix's blast radius never reached this sibling
lane. CRCL (both dates) and AAPL are additional instances not named in that original list, so the
live-violation count did not even shrink to zero in between — new rows kept qualifying.

**Impact:** `plan_pnl_pct`/`plan_outcome` are served directly in the public
`GET /api/market/zerodte/record` payload and reach Largo via `get_zerodte_record`. Per this
module's own comment (line ~193-198), these are the exact numbers the calibration lane
(`calibration.ts`'s `officialPlanPnlPct` import) and the feature store train on — so this was
feeding an impossible P&L number into score-band/tier calibration and the learning store, not
just a display glitch on one member-facing panel.

**Fix:** `officialOverridingRealExit()` now reuses the SAME `clampManagedPnlToPeak()` helper
`managedGradeView()` already calls, applied to the identical `exit.pnl_pct`/`exit.peak_pnl_pct`
pair, and threads the clamped value into `managedOutcomeLabel()` too (mirroring
`managedGradeView()`'s own `const pnl = round2(clampManagedPnlToPeak(...))` precedent) so the
label and the number stay consistent with each other, exactly as the sibling lane already does.
No new clamp logic was written — the whole point of the fix is that both lanes now share the one
function, so they are mechanically unable to drift apart again the way they just did.

**Blast radius:** `officialPlanPnlPct()`/`officialPlanOutcome()` (record.ts) are the only two
callers of `officialOverridingRealExit()`, and they in turn feed: `isGradedZeroDteRow`/
`isZeroDteWin` (used by `calibration.ts`'s score-banding and by `feature-store.ts`'s
`labelFromPlanOutcome`, which this module's own comment documents as required to agree
byte-identically with `isZeroDteWin`), `toPlay()`'s `plan_pnl_pct`/`plan_outcome` fields in the
public `/record` payload, and Largo's `get_zerodte_record` tool (reads the same payload). All of
these now inherit the fix at the one shared call site — no second site needed patching.

**Fix rationale:** reusing `clampManagedPnlToPeak()` rather than writing a second, independent
clamp was deliberate — a second implementation is exactly how these two lanes diverged the first
time (the 2026-10-31 fix added the clamp to one function and nobody re-checked whether a sibling
function needed the identical treatment). Deliberately left unchanged: the clamp's own semantics
(it only ever caps `pnl` down to `peak` when `pnl > peak`; a short position's economics are
already expressed through the sign of `pnl_pct`/`peak_pnl_pct` themselves, not a second floor
branch — read the full function body before assuming it needs one, it does not).

**Evidence (RED → GREEN):** added 3 regression tests to `src/lib/zerodte/record.test.ts`: (a) a
HIMS-2026-08-19 live-shape repro (GENUINE 2-tranche reconstruction + a real ratchet-floor exit
outranking it, `pnl_pct=5.68` > `peak_pnl_pct=5.11`) asserting `officialPlanPnlPct` now equals the
clamped `5.11` and agrees with `asManagedPnlPct`; (b) an APLD-shaped case with the real exit
already sitting within its own peak, asserting the clamp is a provable no-op (no regression); (c)
a CRCL-2026-09-03 live-shape repro with a NEGATIVE peak (`peak_pnl_pct=-0.22`) to cover the
negative-peak sign case, asserting `plan_pnl_pct === managed_pnl_pct` on the same row and that the
row books as a loss, not the pre-clamp breakeven. RED (via `git checkout -- record.ts` to revert
only the source fix, tests kept): 2/52 new assertions failed exactly as expected (`5.68 !== 5.11`,
`0 !== -0.22`); the no-regression case correctly passed even pre-fix. GREEN (fix restored):
`node --import tsx --experimental-test-module-mocks --test record.test.ts` → 52/52 pass. Full
`zerodte` directory suite (`*.test.ts`, 92 files): 1772/1773 pass, 1 pre-existing skip, 0 fail.
`npx tsc --noEmit`: clean on the changed file.
