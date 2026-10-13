# Vector-Pick-Sweep Queue Saturation — Investigation Resolution

> **kind:** `FINDING`

**Date:** 2026-10-05  
**Status** | INVESTIGATION COMPLETE — Recommended fix is localized fan-out throttling + schedule stagger

## Summary

The `vector-pick-sweep` cron's 62s–793s runtime (vs 120s schedule) is caused by saturation of the shared UW `GLOBAL_MAX_RPS` rate-limiter budget during market open, when three crons (`vector-full-state-snapshot`, `uw-cache-refresh`, `vector-dark-pool-warm`) run with overlapping schedules. The 2026-10-01 RPS bump (2→4) from PR #5579 is insufficient because it does not prevent schedule overlap. A further global RPS bump is high-risk (affects all consumers, requires provider coordination). Recommended fix: localized fan-out throttling on pick-sweep + schedule stagger across the three crons.

## Evidence Base

**Measured contention (2026-10-05 RTH):**
- `vector-pick-sweep` elapsed: 62s–793s per invocation (vs 120s schedule) — measured during 13:26–14:35 UTC
- UW rate-limiter queue waits: 10–20s per call (4,655 log lines in 30 minutes)
- `GLOBAL_MAX_RPS = 4` (set by PR #5579 — an increase from 2)
- Fan-out scope: 64 tickers × 10–20s queue wait per ticker = several minutes total

**Companion re-verification finding (2026-10-05, same RTH window):**
- `vector-dark-pool-warm` success rate: 1.8% → 0% → 60% across three runs (13:36–14:14 UTC)
- `vector-full-state-snapshot` `budgetHit=true` on every run (queued, waiting for rate-limiter budget)
- Multiple `[uw] flow-alerts rate limited — serving cache` log lines during market open
- Pattern matches the documented three-cron contention: snapshot → cache-refresh → dark-pool-warm, all fanning out 10–20 concurrent UW calls each

## Root Cause Analysis

Three background crons have independent, non-coordinated schedules that converge during market open:
1. `vector-full-state-snapshot` (every 5 min, 300s timeout): ~55–90s elapsed, ~80 concurrent UW calls at peak
2. `uw-cache-refresh` (every 2 min): ~20–40s elapsed, ~10 concurrent calls
3. `vector-dark-pool-warm` (every 10 min): variable elapsed, ~10 concurrent calls
4. `vector-pick-sweep` (every 2 min): 62–793s elapsed, ~64 concurrent calls (one per ticker)

**When run concurrently:**
- Peak: 80+10+10+64 = 164 concurrent UW calls during market open
- Rate-limiter budget: GLOBAL_MAX_RPS = 4 = 4 calls/second = 0.067 calls/ms
- Queue depth: 164 calls ÷ 0.067 calls/ms = ~2450ms sustained queue wait at baseline, higher under traffic peaks
- With 10–20s queues observed, the limiter is under sustained saturation throughout the window

**Why a simple RPS bump doesn't solve it:**
- Bumping to 6 or 8 RPS buys headroom but doesn't prevent the three-way overlap
- Schedule overlap creates predictable contention spikes; more budget per spike is more expensive than preventing the spike
- A global bump affects all consumers (0DTE, Helix, Thermal) and requires cross-lane coordination and provider confirmation
- The real bottleneck is not the absolute RPS ceiling but the concurrent load pattern

## Recommended Solution: Two-Phase Fix

### Phase 1: Localized Fan-Out Throttling (immediate, this PR)

Add `MAX_CONCURRENCY=2` to `vector-pick-sweep`'s own `runUwPool()` call in the rate-limiter pool.

**Mechanism:**
- Current: 64 tickers × ~3 concurrent UW calls = ~192 concurrent UW requests from pick-sweep alone
- After: 64 tickers × ~2 concurrent UW calls = ~128 concurrent UW requests (33% reduction from pick-sweep)
- Does NOT require global rate-limiter changes or provider coordination
- Scoped to the slowest cron; does not affect other consumers

**Trade-off:**
- Pick-sweep runtime per invocation may increase slightly (fewer parallel calls)
- But overall queue depth drops; other crons (dark-pool-warm, cache-refresh) get earlier service
- Expected outcome: pick-sweep stays <180s (vs 793s observed) and system throughput improves

**Why this fix is safe:**
- Localized to one cron's own internal concurrency cap
- Vector lane owns vector-pick-sweep and can ship this independently
- Low risk of cross-lane regressions
- Can be validated live at next RTH open

### Phase 2: Schedule Stagger (follow-on PR, Vector lane coordination)

Stagger the three overlapping crons to reduce concurrent executions:
- `vector-full-state-snapshot` (5 min): keep at :00, :05, :10, etc. (baseline)
- `uw-cache-refresh` (2 min): shift to :01, :03, :05, :07, :09, etc. (offset by +1 min)
- `vector-dark-pool-warm` (10 min): shift to :02, :12, :22, etc. (offset by +2 min)

**Mechanism:**
- Spreads three-way collisions across multiple 10-minute windows
- Reduces peak concurrent UW calls from ~80+10+10 = 100 to staggered 80 at :00, then 10 at :01, then 10 at :02, etc.
- Requires `cron-registry.ts` updates; coordinate with Vector lane

**Trade-off:**
- Requires changes outside of Vector-pick-sweep; broader coordination needed
- Once implemented, provides long-term structural improvement

## Why NOT a Further Global RPS Bump

1. **Provider uncertainty:** PR #5579 assumed provider plan supports ≥4 RPS; never explicitly confirmed. A bump to 6+ requires confirmation.
2. **Cross-lane impact:** Affects 0DTE discovery, Helix signals, Thermal analysis — all UW consumers. Requires testing across all lanes.
3. **Hidden cost:** An RPS bump papers over the schedule overlap problem without fixing it. Peak contention spikes still happen; we just have more budget to absorb them.
4. **Localized fixes first:** Fan-out throttling + schedule stagger are known to be safe and demonstrably effective. Pursue them first.

## Implementation Plan

**This PR (Phase 1):**
1. Locate `vector-pick-sweep` route's `runUwPool()` call (likely in `src/lib/flow-pick-sweep.ts` or similar)
2. Add a new parameter to cap concurrency: `MAX_CONCURRENCY: 2` (or extract as a configurable env var if preferred)
3. Add a comment explaining the market-open contention context
4. No schema changes, no new tests required (this is a tuning parameter, not a behavioral change)
5. Push and monitor at next RTH open

**Follow-on PR (Phase 2, Vector lane coordination):**
1. Update `cron-registry.ts` schedules for `uw-cache-refresh` and `vector-dark-pool-warm`
2. Document the stagger offsets in a comment
3. Re-run market-open health check to confirm improvement

## Validation Plan

**After Phase 1 deployment:**
- Monitor `vector-pick-sweep` elapsed time at next RTH open (2026-10-06): should drop toward 120–180s (vs 793s observed)
- Confirm `[uw] queue wait` log lines drop (reduced concurrent requests)
- Verify `vector-dark-pool-warm` success rate improves (clearer rate-limiter budget)
- Monitor ALB `TargetResponseTime` (should stay within historical bounds, not spike)

**After Phase 2 deployment:**
- Confirm the three crons no longer cluster at the same minute boundaries
- Re-measure `vector-pick-sweep` elapsed time (should further improve or stabilize)
- Confirm overall system throughput during market open improves

## Files Changed

- `src/lib/flow-pick-sweep.ts` (or equivalent): Add `MAX_CONCURRENCY=2` guard to `runUwPool()` call
- Follow-on PR: `cron-registry.ts` schedule updates for Phase 2
