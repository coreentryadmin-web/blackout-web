## Night Hawk 0DTE: `exit-engine.ts` exit-narrative `detail` strings embedded the raw, unrounded live option mark (3+ decimals) instead of the product's standard 2dp premium formatting

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate (0DTE/Night Hawk Command "keep digging" sub-mandate on the 0DTE/Largo surface), 2026-10-26 |
| **Scope** | `src/lib/zerodte/exit-engine.ts` (8 `detail:` template-string call sites across `decideTrimScale`/`evaluateExitState`); consumed by `src/lib/platform/zerodte-service.ts` (`ledger[].exit_detail` on `GET /api/market/zerodte/board`) and `src/lib/zerodte/play-timeline.ts` (`entry_context.exit.detail` on `GET /api/market/zerodte/record`, which Largo/Ask Largo narrative tools read) |

### Root cause

Every EXIT/TRIM decision's member-facing `detail` string is built via a template like
`` `Mark ${currentMark} (${fmtPct(pnlPct)}) is at/below the plan stop ${input.planStop} — ...` ``.
`fmtPct` explicitly `round2()`s the percentage, and `input.planStop`/`input.planTarget` are already
2dp (rounded at commit time) — but `currentMark`, the live option mark, was interpolated with **no
rounding or formatting at all**. The live mark legitimately lands on a half-cent
(`mid=(bid+ask)/2`, per `live-marks.ts`'s own documented rationale: "2dp would silently destroy
real half-cent mids") or carries ordinary live-quote float noise, so a mark like `1.355` or
`0.465` rendered verbatim — a 3-decimal dollar figure sitting beside an already-2dp plan stop/
target in the very same sentence. Every OTHER premium field this product shows a member
(`entry_premium`, `last_mark`, `peak_premium`, `trough_premium`, the plan stop/target themselves)
is consistently 2dp both at the data layer and in the UI (`ZeroDteBoard.tsx` calls `.toFixed(2)`
on each) — this narrative string was the one place that convention was never applied.

Confirmed live in production 2026-10-26: TSLA board ledger row — `exit_detail` `"Mark 1.355
(+6.69%) is at/below the +8.03% floor..."` sits beside the SAME row's `entry_premium` 1.27 /
`last_mark` 1.37 / `peak_premium` (all clean 2dp). A record play (SPXW, 2026-10-23) —
`exit.detail` `"Mark 0.465 (-51.56%) is at/below the plan stop 0.48 — the printed stop is
authoritative."` shows the inconsistency within one sentence: the live-mark half is raw/3-decimal
while the printed plan-stop half (already rounded at commit) is clean 2dp.

There are 8 near-identical call sites across `decideTrimScale` (trim_scale mode) and
`evaluateExitState` (ratchet mode) — plan-stop exit (×2, byte-identical wording), shared/ratchet
protective-floor exit (×2, different wording per mode but the same raw-mark bug), plan-target
trim/final (×2 each mode) — all sharing the same root cause: none rounded `currentMark` before
interpolation.

This is a **different** defect from PR #6858 (which fixed GREEK fields via `board/route.ts`'s
top-level `roundFloats()` `keyDp` map): this text is assembled directly in `exit-engine.ts` as a
pre-built string, never passing through `roundFloats()` at all.

### Fix

Added a local `fmtMark` helper mirroring `fmtPct`'s pattern (`const fmtMark = (n: number) =>
n.toFixed(2);`, same `.toFixed(2)` convention already used elsewhere in this file, e.g.
`intel.ts`'s `$${n.toFixed(2)}`) and replaced every `${currentMark}` interpolation inside a
`detail:` string with `${fmtMark(currentMark)}` across all 8 call sites. Deliberately scoped to
ONLY the displayed text: `pnlPct` (and every other P&L computation) still divides the **raw**,
unrounded `currentMark` exactly as before — this file's own existing tests
(`buildExitContext: a thesis exit's pnl_pct must not be erased by cent-rounding the observed mid`)
already lock in why rounding the mark before computing P&L would be wrong (it can erase real P&L
on a low-priced 0DTE premium). The fix never touches that computation, only how the mark is
*displayed* in the narrative sentence.

### Regression test

Added 6 new tests to `src/lib/zerodte/exit-engine.test.ts`, one per distinct narrative wording,
each feeding a realistic 3-decimal live mark (`1.355`, `0.465`, `5.355`, `8.005`, `4.317`) and
asserting the rendered `detail` string shows the 2dp form and never the raw multi-decimal value:
plan_stop (trim_scale + ratchet), the shared/ratchet protective floor, and the plan-target trim/
final pair (both modes).

### Verification

- RED→GREEN proof: `git stash push -- src/lib/zerodte/exit-engine.ts` (keeping the new tests in
  the working tree) reproduced the exact live-production bug — all 6 new tests failed with the raw
  3-decimal mark in the `detail` string (e.g. `'Mark 1.355 (-66.12%) is at/below the plan stop 2 —
  ...'`), byte-for-byte matching the originating report's TSLA/SPXW examples. Restoring the fix
  (`git stash pop`) turned all 6 GREEN.
- `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/exit-engine.test.ts`
  (Node 20) — 113/113 pass (107 pre-existing + 6 new).
- `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/exit-policy-snapshot.test.ts
  src/lib/zerodte/exit-sync.test.ts src/lib/zerodte/record.test.ts src/lib/zerodte/scan.test.ts
  src/lib/zerodte/strategy-version.test.ts src/lib/platform/zerodte-service.test.ts` (Node 20) —
  158/158 pass (every consumer of `exit-engine.ts`'s decision/detail output).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
