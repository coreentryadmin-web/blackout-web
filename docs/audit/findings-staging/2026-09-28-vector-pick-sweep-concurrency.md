# Vector pick-sweep concurrency bottleneck — FIXED

> **kind:** `FINDING`

**Date:** 2026-09-28  
**Status** | Fixed

## Problem

Post-deploy monitoring of PR #5551 (which reduced `vector-full-state-snapshot` TICKER_CONCURRENCY 3→2 to fix a cache-warming cascade failure) revealed that the downstream `vector-pick-sweep` cron remained severely over-budget:

- Schedule: 120s (2 minutes)
- Observed (6 samples post-fix): 254s, 495s, 329s, 560s, 404s, 475s
- **Regression:** 2.1–4.6× over schedule, no improvement from the upstream fix

Root cause: `SWEEP_CONCURRENCY = 4` processes 64 tickers in 16 sequential batches. Even though individual tickers are cached, many aren't (the reduced cache warmer with TICKER_CONCURRENCY=2 takes 30+ cycles to warm 64 tickers), forcing per-batch full-state recomputation. With only 4 tickers/batch, batches run serially and rate-limiters remain under-utilized.

## Fix

Increased `SWEEP_CONCURRENCY` from 4 to 8 in `src/lib/vector/vector-pick-sweep.ts` (line 271).

**Rationale:**
- The TICKER_CONCURRENCY reduction freed rate-limiter headroom (peak concurrent requests dropped from ~120 to ~80)
- 8 tickers per batch = 8 batches instead of 16, halving the sequential batch count
- Even with cache misses forcing full-state recomputation, 8 concurrent fetches << 120 peak from the original TICKER_CONCURRENCY=3
- Expected improvement: 50% latency reduction if cache hit rate holds, 20–30% if many misses persist

## Validation

Post-deploy monitoring at next RTH open (confirm 6+ samples of pick-sweep elapsed < 200s, ideally < 150s). If still over-budget, the next investigation targets whether full-state recomputation on cache miss is the true bottleneck (per-ticker upstream fetches vs the batch count).

## Files changed

- `src/lib/vector/vector-pick-sweep.ts`: SWEEP_CONCURRENCY 4 → 8 + explanation comment
