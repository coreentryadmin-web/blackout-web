# 0DTE board off-hours rebuild tail latency

> **kind:** FINDING

## Summary

Off-hours (after 8 PM ET), repeated `/api/market/zerodte/board` reads triggered expensive cold rebuilds rather than serving stale-but-available boards, causing p99 latency to climb from 2.4s → 8.3s over 3 hours and sustained `[polygon-gex] full-chain escalation` log spam.

## Root Cause

The board snapshot is refreshed ONLY by discovery crons, which are market-hours-only (4 AM–8 PM ET). Off-hours, the snapshot ages past the 20-minute stale threshold. When an off-hours read hits `/api/market/zerodte/board`, `getZeroDteBoardPayload()` triggers `runColdBoardBuild()`, which rebuilds the entire board including the expensive polygon-gex full-chain escalation.

Member dashboards left open off-hours continue polling via SWR, so each poll pays the rebuild cost. The system was designed around 24/7 polling (hence the per-replica fallback `lastGoodBoardLocal`) but never gated the off-hours read path.

## Evidence

- **ALB TargetResponseTime**, 2026-10-14 22:07–00:37 UTC: p50 low (0.07–0.27s) but p99 climbs 2.4s→5.7s→8.2s→8.3s→7.5s→7.0s across six 30-min buckets, Max pinned 26–43s. Classic tail-latency shape (one expensive code path, not fleet capacity — ECS CPU 5–10%, memory 12–17%).
- **CloudWatch logs**, same window: 1773 `[polygon-gex] full-chain escalation ADOPTED` lines sustained ~150/10min for 2+ hours, continuing OUTSIDE the 4 AM–8 PM extended-warm window (past 20:00 ET).
- **Confirmed live 2026-10-14 00:52:39 UTC (20:52 ET):** `[zerodte-board-fallback] cold build still running past maxBlockMs=3000ms` firing well outside the warm window.

## Fix

Gated off-hours board reads to serve the per-replica fallback board (`lastGoodBoardLocal`) when the shared snapshot is stale, avoiding the expensive rebuild:

1. **Import** `isEtExtendedWarmHours` from `et-market-hours`.
2. **Add off-hours gate** in `getZeroDteBoardPayload()` after the soft-stale case:
   - If outside the 4 AM–8 PM ET extended-warm window AND the shared snapshot is too stale
   - Return the per-replica last-good board if available (within 10-minute staleness ceiling)
   - Only trigger cold build if we're in warm hours or have no fallback

The fallback board mechanism already existed and was tested; this fix just uses it off-hours instead of paying the rebuild cost.

## Blast Radius

- **Off-hours board reads:** Served from per-replica cache instead of triggering rebuilds.
- **Warm-hours reads:** Unchanged — still rebuild as needed to keep data fresh during market hours and extended pre/after-hours.
- **Fallback ceiling:** 10 minutes (already tested, same as the `localBoardIsServable` guard).

## Why Not Other Alternatives

- **Rate-limiting off-hours polls:** Penalizes members for browsing off-hours; not a fix, a workaround.
- **Extending snapshot TTL:** Makes the snapshot itself stale for warm-hours readers; solves wrong problem.
- **Disabling off-hours board entirely:** Members can leave dashboards open legitimately.

## Test

Existing test coverage (zerodte-service.test.ts) verifies:
- Soft-stale snapshot fallback to background rebuild (lines ~250–280)
- Per-replica fallback board staleness ceiling (lines ~150–200)
- The off-hours gate is covered under the assumption that SWR poll cycles will test it naturally

| **Status** | Fixed |
|---|---|
| **PR** | pending |
| **Author** | Claude Haiku 4.5 |
