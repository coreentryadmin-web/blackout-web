# 0DTE board: CLOSED-row floor_pnl_pct/peak_pnl_pct recomputed from live peak_premium instead of the frozen exit-time value — FIXED

> **kind:** FINDING

| **Status** | FIXED |
|------------|-------|

## Symptom

Live `GET /api/market/zerodte/board` ledger (production, 2026-10-21), 4/4 sampled CLOSED committed
rows showed served `floor_pnl_pct`/`peak_pnl_pct` disagreeing with the SAME row's own pinned
`exit_detail` narrative:

- QQQ: served `floor_pnl_pct=4.44` (`peak_pnl_pct=11.11`) vs `exit_detail` text "...+4.24% floor
  armed by a +10.61% peak"
- SPCX: served 4.59 vs text 4.52/11.3
- NVDA: served 2.34 vs text 2.27/5.67
- AAPL: served 2.08 vs text 2.0/5.0

In every case `floor_pnl_pct == round2(peak_pnl_pct * 0.4)` (the ratchet lock floor fraction)
computed from the row's FINAL/current `peak_premium` — not the peak that was actually armed at the
real exit decision, which `entry_context.exit.detail`'s prose was built from and still carries
honestly in `entry_context.exit.peak_pnl_pct`.

The member-facing board UI already gates the floor chip off for CLOSED rows
(`ZeroDteBoard.tsx`: `row.floor_pnl_pct != null && row.status !== 'CLOSED'`), so this was not
currently member-visible on the primary UI — but the raw API field was still wrong for any other
consumer (audit tooling, Largo, a future UI).

## Root cause

`src/lib/platform/zerodte-service.ts`'s post-`roundFloats()` recompute pass (the block added
2026-10-20 to reconcile `peak_pnl_pct`/`mfe_capture_pct`/`floor_pnl_pct` with the member-visible
ROUNDED `entry_premium`/`peak_premium`) ran **unconditionally for every ledger row, including
CLOSED ones** — always deriving `peak_pnl_pct` from `peakPnlPct(row.entry_premium,
row.peak_premium)`, i.e. the row's current/final latched peak.

`floor_pnl_pct`'s own doc comment on `ZeroDteBoardLedgerRow` explicitly frames it as **live-only
guidance** ("your stop is now at breakeven/+20%/+50%" — guidance for a still-open position). A
CLOSED row has no "your stop is now at" to give; what it owes the reader instead is the value that
was actually true **at the moment the exit decision fired**, which is already honestly recorded on
the row: `entry_context.exit` is stamped first-write-wins (`stampZeroDteExitContext`) by
`buildExitContext` (`exit-engine.ts`) off the exact `peakPremium` the engine used for that decision
— the identical input `exit.detail`'s prose was generated from (`exit-engine.ts` lines ~891-926).
`peak_premium` on the row, by contrast, is a continuously-latched field
(`advancePlayLatch`/`updateZeroDteLiveState`) that is not contractually pinned to equal the peak the
engine actually armed its floor against at that tick — so recomputing from it for a CLOSED row can
silently disagree with the row's own frozen narrative, which is exactly what the live QQQ/SPCX/NVDA/
AAPL samples show (peak/floor drifted ~0.3-0.5pp above the frozen decision-time value in every
sampled case).

This was not caught earlier because the 2026-10-20 rounding-reconciliation fix was scoped to a
different bug (display-rounding self-consistency between a row's OWN `peak_premium`/`entry_premium`
fields and its `peak_pnl_pct`) and never distinguished CLOSED rows with a pinned exit stamp — the
UI-level gate (`row.status !== 'CLOSED'`) hid the member-facing symptom, so nothing surfaced it
until a direct API/field audit compared `floor_pnl_pct`/`peak_pnl_pct` against `exit_detail`'s own
embedded numbers.

## Fix

`src/lib/platform/zerodte-service.ts`'s recompute pass now reads the row's own frozen exit stamp
(`readExitStampFromEntryContext(r.entry_context).peak_pnl_pct` — already on the payload honestly,
previously unused for this purpose) and, **only for a CLOSED row that carries one**, uses that
frozen peak for `peak_pnl_pct`/`mfe_capture_pct`/`floor_pnl_pct` instead of recomputing from
`peak_premium`. A CLOSED row with NO exit stamp (a mechanical plan-stop or a genuine 15:50 ET
time-stop — neither stamps `entry_context.exit`) has no better frozen source and keeps the existing
rounded-premium recompute unchanged. OPEN/HOLD/TRIM rows are completely unaffected — the guard is
`row.status === "CLOSED"` only.

`floor_pnl_pct` is now derived from the SAME resolved `peakPnl` (frozen-or-live) rather than
re-deriving `pinnedLivePnlPct(row.entry_premium, row.peak_premium)` a second time, which also
removes a redundant duplicate computation and guarantees `floor_pnl_pct` can never disagree with
the `peak_pnl_pct` served on the same row.

Deliberately left unchanged: the UI gate that already hides `floor_pnl_pct` for CLOSED rows (kept
as defense in depth, not removed just because the underlying field is now correct); `exit_policy`
(the trim ladder) and `live_pnl_pct`, which were not shown to disagree with the frozen narrative and
are out of this fix's scope.

## Evidence

Regression test added to `src/lib/platform/zerodte-service.test.ts`
("exit visibility (CLOSED, frozen floor): a CLOSED row's peak_pnl_pct/floor_pnl_pct/mfe_capture_pct
match the FROZEN exit-time peak, not the row's current peak_premium (QQQ-class live repro)"), which
pins a CLOSED row with `entry_context.exit.peak_pnl_pct = 10` (the frozen decision-time peak) but a
drifted current `peak_premium` implying +15%. RED→GREEN proven via `git stash` on the source file
only:

- **Pre-fix (RED):** `peak_pnl_pct` served `15` (recomputed from the drifted `peak_premium`),
  `floor_pnl_pct` served `6` (`15×0.4`), `mfe_capture_pct` served `27` — test failed:
  `peak_pnl_pct must match the FROZEN exit-time peak ... 15 !== 10`.
- **Post-fix (GREEN):** `peak_pnl_pct=10`, `floor_pnl_pct=4` (`10×0.4`), `mfe_capture_pct=40` — all
  27 tests in the file pass, matching the frozen `exit_detail`-implied narrative exactly.

The pre-existing "rounding reconcile" test (2026-10-20 fix) was retargeted from a CLOSED row to a
HOLD row — with a CLOSED row and a pinned exit stamp, the frozen value now wins outright (by
design), which would make that test's raw-vs-rounded-peak scenario unreachable through a CLOSED
row; the rounding-reconciliation behavior itself is unchanged and still applies to every OPEN/HOLD/
TRIM row and to a CLOSED row with no exit stamp (verified by the existing "a stopped play with no
trim tranches armed" test, which has no `entry_context.exit` and is untouched by this fix).

Full suite: `src/lib/platform/zerodte-service.test.ts` (27/27), plus the sibling
`zerodte-ledger-pnl.test.ts`/`zerodte-board-convergence.test.ts`/`zerodte-service-marks.test.ts`/
`exit-sync.test.ts`/`exit-engine.test.ts`/`play-timeline.test.ts`/`marks-math.test.ts` (216/216
combined) — all GREEN on Node 20. `npx tsc --noEmit` clean (full project).

## Blast radius

Single call site: the post-`roundFloats()` recompute pass in `buildZeroDteBoardPayload`
(`zerodte-service.ts`) is the ONLY place that serves `peak_pnl_pct`/`floor_pnl_pct`/
`mfe_capture_pct` on the public `/api/market/zerodte/board` ledger and the Largo
`zeroDtePlaysForLargo` payload (both built from the same `payload.ledger`) — no second
implementation of this computation exists elsewhere. `mapLedgerRow`'s own earlier, pre-`roundFloats`
computation of these same three fields is unconditionally overwritten by this pass regardless of
status, so it needed no parallel fix. The member-facing UI (`ZeroDteBoard.tsx`) already suppresses
`floor_pnl_pct` for CLOSED rows, so no visual change there; `peak_pnl_pct`/`mfe_capture_pct` ARE
shown on closed cards and now read the correct frozen value for any row with a pinned engine exit.
