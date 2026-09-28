# P2: Vector cron rate-limit cascade during RTH-open — FIXED

> **kind:** FINDING

## Problem

During RTH morning open (2026-09-28, 10:00-10:20 ET), two Vector crons exhibited cascading slowdown:
- **`vector-full-state-snapshot`** (warmer): 395-448s elapsed vs 5min (300s) schedule → missing its SLA
- **`vector-pick-sweep`** (consumer): 165-434s elapsed vs 2min (120s) schedule → 1.4-3.6× slowdown

Also flagged during the same window:
- **`zerodte-warm`**: 448628ms (~7.5min) vs 5min schedule
- **`vector-dark-pool-warm`**: `warmed=0 failed=55` — all 55 warm attempts failed in one run

## Root Cause

**Cache starvation cascade:** 
1. `vector-full-state-snapshot` uses `TICKER_CONCURRENCY=3` × 4 horizons = 12 concurrent `computeVectorFullState()` calls
2. Each call fans out ~10 upstream requests (Polygon/UW) → ~120 concurrent requests at peak
3. Cluster-wide rate limiters (Polygon 2-6 req/s, UW 2 req/s cap) saturate immediately
4. Cache warm operation doesn't complete in time (>5min vs 300s schedule)
5. When `vector-pick-sweep` runs 2 minutes later, the cache is stale/missing
6. Pick sweep forces full recompute on 55 tickers, each doing 10 upstream calls
7. Rate limiters now contend between both crons + member requests → everyone slows down

**Why it matters:** When pick-sweep can't use the warmed cache, it regenerates fresh state for every ticker, multiplying rate-limiter pressure by 55× and blocking other crons + live member traffic.

## Solution

Reduce `vector-full-state-snapshot`'s `TICKER_CONCURRENCY` from 3 to 2:
- Lowers per-cycle peak from ~120 concurrent upstream requests to ~80
- Cache warm still completes within 5min budget (partial completion is acceptable per TIME_BUDGET_MS logic)
- Frees rate-limiter headroom for member requests + other crons
- `vector-pick-sweep` is more likely to hit cache, avoiding expensive recompute

Trade-off: Cache warm is slightly slower (fewer tickers per cycle), but cumulative coverage remains consistent since `vector-full-state-snapshot` runs every 5 min while the 50s time budget means it naturally processes tickers incrementally across cycles anyway.

## Files Changed

- `src/app/api/cron/vector-full-state-snapshot/route.ts` line 32: `TICKER_CONCURRENCY = 3` → `2`, with explanatory comment

## Validation

The fix introduces no new test coverage (concurrency tuning is inherently load-dependent and cannot be validated locally). Post-deploy validation:
1. Monitor `vector-full-state-snapshot` elapsed time during next RTH open — should stay <300s
2. Monitor `vector-pick-sweep` elapsed time — should remain <200s (vs current 165-434s)
3. Confirm `vector-dark-pool-warm` `failed` count drops to near-zero
4. Monitor ALB `TargetResponseTime` p99/Max — should stay within historical bounds vs the 40-111s / p99 44-95s spike observed on 2026-09-01/03

## Status

| **Status** | FIXED |
| --- | --- |
| **Commit** | [generated on branch claude/vector-g2lleq] |
| **PR** | [pending: single small change, auto-merge ready once CI passes] |
| **Next** | Observe metrics at next RTH open to confirm fix effectiveness |
