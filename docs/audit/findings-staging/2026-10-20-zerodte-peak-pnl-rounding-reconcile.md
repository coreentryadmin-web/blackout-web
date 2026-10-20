## 0DTE peak_pnl_pct/mfe_capture_pct/floor_pnl_pct computed from the raw pre-rounding premium, disagreeing with the row's own displayed peak_premium — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo × Night Hawk Swings standing mandate / 5-engine live monitor
Workflow deep-dive, live `GET /api/market/zerodte/board` + `/api/market/zerodte/record` spot-check —
a real BMNR ledger row showed `entry_premium: 0.64`, `peak_premium: 0.70`, `peak_pnl_pct: 8.59`. A
member computing the obvious (peak−entry)/entry off the row's own two DISPLAYED numbers gets
`(0.70−0.64)/0.64 = 9.37%`, not the `8.59%` the board actually showed — the two fields on the same
row disagreed with each other by ~0.78pp.

**Root cause:** `mapLedgerRow` (`src/lib/platform/zerodte-service.ts`) computes `peak_pnl_pct`,
`mfe_capture_pct`, and `floor_pnl_pct` from the RAW, pre-`roundFloats()` `entry_premium`/
`peak_premium` read off the DB row. `buildZeroDteBoardPayload`'s closing `roundFloats()` call then
rounds `entry_premium` and `peak_premium` to 2dp INDEPENDENTLY of each other — so a half-cent raw
peak (`0.695`) rounds UP to a displayed `0.70` while `peak_pnl_pct` keeps reporting the number
derived from the raw, never-shown `0.695` (`(0.695−0.64)/0.64 = 8.59%`). `live_pnl_pct`,
`live_pnl_pct_exec`, and `exit_policy` already get an identical post-`roundFloats()` re-derivation a
few lines below this exact spot (with their own comment explaining why), for the exact same
reason — but `peak_pnl_pct`/`mfe_capture_pct`/`floor_pnl_pct` never got the same treatment. The gap
is structural, not a one-off typo: any ledger row whose raw peak lands within ~0.008 of a cent
boundary reproduces it, and it is strictly more likely on cheap (sub-$1) 0DTE premiums, where a
half-cent is already several percent of the premium itself.

**Live impact:** `mfe_capture_pct` compounds the same staleness (it divides the exit P&L by the
STALE `peak_pnl_pct`), and `floor_pnl_pct` (the ratchet's `peak×0.4` protective-floor display) does
too — so three separate member-facing numbers, not just one, quietly used a peak percentage the row
itself no longer displays. This reaches Largo's `get_zerodte_plays` tool and the board route
identically (both delegate to `buildZeroDteBoardPayload`), so an Ask Largo narration of "your floor
is now at X%" or "you captured Y% of the peak move" could cite a number inconsistent with the same
reply's own `peak_premium`/`entry_premium` fields — a Largo product-contract C3/precision concern
(a number the model can be asked to double-check against sibling fields in the same payload and get
a different answer from arithmetic a member can do by hand).

**Fix:** Re-derive `peak_pnl_pct` (`peakPnlPct`), `mfe_capture_pct` (`mfeCapturePct`), and
`floor_pnl_pct` (`ratchetFloorPct` + `ratchetTargetReached`) from the already-rounded `row.
entry_premium`/`row.peak_premium`/`row.exit_pnl_pct`/`row.target_pct` inside the SAME post-
`roundFloats()` ledger remap block that already re-derives `live_pnl_pct`/`live_pnl_pct_exec`/
`exit_policy` — the identical functions `mapLedgerRow` itself uses, just fed the rounded inputs
instead of the raw ones. `target_pct` is `number | null` on the row (frozen target may be absent),
so the re-derivation falls back to `PLAN_RULES.target_pct` exactly as `playRailsFromRow`'s own
resolution chain already does.

**Fix rationale:** Mirrors the established, already-shipped pattern for `live_pnl_pct` rather than
inventing a new one — same file, same block, same "recompute from the member-visible rounded
numbers" principle. Left `mapLedgerRow`'s own raw computation of these three fields in place
(harmless — it's immediately overwritten by the re-derivation) rather than removing it, since other
internal logic in `mapLedgerRow` (e.g. the row's own `floorPnlPct` local var feeding `closed_reason`/
`exit_reason` categorization a few lines earlier) legitimately needs the raw, pre-rounding value at
that point in the pipeline — only the FINAL payload fields needed re-deriving, not the intermediate
computation.

**Blast radius:** Single block, single call site (`buildZeroDteBoardPayload`'s closing ledger remap,
already shared by both the member board route and Largo's `zeroDtePlaysForLargo`/`get_zerodte_plays`
— no second consumer to fix separately).

**Tests:** 1 new regression test in `zerodte-service.test.ts` — a half-cent-peak scenario
(`entry_premium: 0.64, peak_premium: 0.695`, the real live BMNR numbers) asserts `peak_premium`
rounds to the displayed `0.70`, `peak_pnl_pct` reconciles to `9.37` (not the stale raw `8.59`),
`mfe_capture_pct` reconciles to `53` (not the stale raw `58`), and `floor_pnl_pct` reconciles to
`3.75` (not the stale raw `3.44`). RED→GREEN proven via `git stash` (fails against pre-fix source
with the exact stale `8.59`, passes post-fix). `tsc --noEmit` clean. Full `zerodte-service.test.ts`
(26 tests) + `zerodte-service-marks.test.ts` (1 test) green, run on Node 20.
