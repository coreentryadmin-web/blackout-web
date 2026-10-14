> **kind:** FINDING

## swing/record: composite.sumPnlPct/compoundedReturnPct don't always reconcile with served legs — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `buildSwingRecord` (`src/lib/swing/record.ts`) computed `composite.sumPnlPct` and
`composite.compoundedReturnPct` from the RAW (unrounded) per-leg `realized_pnl_pct` DB values, while
`legs[].realizedPnlPct` itself stayed raw until the `/api/market/swing/record` route wrapped the whole
response in one `roundFloats(..., 2)` call at the API boundary. Rounding is not distributive over
addition or compounding, so a pair of raw leg P&Ls that EACH independently round down can still sum to
a value that rounds UP in aggregate (or vice versa) — the composite and the served legs disagree by a
cent, and the natural hand-check a member or Largo would do on the two adjacent numbers fails.

**Evidence.** Live `GET /api/market/swing/record?days=90` (2026-10-14, 90-day window), captured via the
standing Ask Largo deep-dive workflow. Of 3 multi-leg (rolled) resolved chains in the window, 2 showed
a mismatch: rootPositionId=37 (AAPL) — legs displayed -22.3/47.37 (sum 25.07 by hand), but
`composite.sumPnlPct` served as 25.06, and `compoundedReturnPct` served as 14.5 vs 14.51 implied by
compounding the two shown legs. rootPositionId=44 (AMZN) — legs -27.67/72.41 summed correctly to 44.74,
but `compoundedReturnPct` served as 24.71 vs 24.70 implied. rootPositionId=30 (a 2-leg loss chain,
-40.83/-33.19) reconciled exactly — so this is intermittent, triggered only when a raw per-leg P&L
lands on a value whose 2dp rounding shifts the composite math by a cent, not a universal defect.

This is the same class of bug the file's own `worstLegPnlPct` fix (2026-09-12) already addressed for
a different field — `worstLegPnlPct` is a MIN operation, which commutes with rounding (negligibly),
so rounding it at the aggregate level alone was sufficient; SUM and COMPOUND do not commute with
rounding the same way, so they needed the per-leg value rounded FIRST.

**Blast radius.** `legs[].realizedPnlPct` is the shared single source every downstream consumer in
this module reads (`composite.sumPnlPct`, `composite.compoundedReturnPct`, `composite.worstLegPnlPct`
indirectly, and the `legs` array itself as served). No other file computes this aggregation
independently — grepped `FINDINGS.md` for `sumPnlPct`/`compoundedReturnPct` reconciliation, no prior
entry covers this exact gap.

**Fix.** Round `realized_pnl_pct` to 2dp at the SAME single point of truth the `worstLegPnlPct` fix
already established — inside `buildSwingRecord`'s leg-mapping, before it's used anywhere downstream.
`win: isSwingWin(r.realized_pnl_pct)` deliberately still reads the RAW value, unchanged — the strict
`>0` win check must not flip on an ultra-tiny P&L that rounds to 0.00. With legs rounded at source,
`roundFloats()` at the API boundary becomes a no-op on an already-2dp value, matching the file's
established "single point of truth" discipline.

**Fix rationale.** Rounding each leg before aggregating (rather than aggregating raw then rounding
once) is the only way to make the composite and the served legs — which a member/Largo read side by
side — agree exactly, the same reasoning the `worstLegPnlPct` fix already used for its own field.

**Tests.** `record.test.ts` gained one test: two legs with raw P&Ls (10.004, 10.004) chosen so each
independently rounds down (10.00) but their raw sum rounds up (20.01) — the deterministic reproduction
of the live discrepancy's shape. Asserts the served `composite.sumPnlPct`/`compoundedReturnPct` exactly
equal hand-summing/hand-compounding the served legs. RED→GREEN proven: `git stash` of the `record.ts`
fix dropped exactly 1 of 15 tests (the new one); restoring the fix brought all 15 back to green.
`tsc --noEmit` clean on Node 20.
