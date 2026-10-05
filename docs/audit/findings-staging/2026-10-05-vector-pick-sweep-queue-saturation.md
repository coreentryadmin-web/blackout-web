# Vector pick-sweep queue saturation during RTH — INVESTIGATION NEEDED

> **kind:** `FINDING`

**Date:** 2026-10-05  
**Status** | Investigation needed (follow-on to PR #5579 dark-pool-warm fix)

## Problem

Measured live (CloudWatch /ecs/blackout-production, 13:26-14:35 UTC 2026-10-05, RTH open): `vector-pick-sweep` is running 62s–793s per invocation against its 120s schedule. Worst case: 793,660ms (13.2 minutes) — a multi-minute overrun.

Key measurement:
- UW rate-limiter queue waits: 10–20s per call
- Log volume: 4,655 "[uw] queue wait" lines in 30 minutes
- UW_GLOBAL_MAX_RPS saturated at 4 (recently increased from 2 by PR #5579)
- Fan-out impact: 64 tickers × multi-second queue waits = several minutes total runtime

## Scope

This measurement occurred **3–4 days after PR #5579 deployed** (GLOBAL_MAX_RPS 2→4), confirming:
- **PR #5579 likely resolved the vector-dark-pool-warm 0% success issue** (dark-pool-warm needed higher RPS)
- **But 4 RPS is structurally insufficient** for concurrent background-cron demand during peak RTH

The overlap guard from PR #3295 is working (no duplicate concurrent runs observed), but the underlying sweep runtime remains multi-minute due to RPS starvation, not concurrency starvation.

## Root Cause

UW rate-limiter is a cluster-wide bottleneck during market open when multiple background crons run concurrently:
- `vector-full-state-snapshot` (every 5 min): ~55–90s elapsed
- `uw-cache-refresh` (every 2 min): ~20–40s elapsed  
- `vector-dark-pool-warm` (every 10 min): expected <40s post-PR #5579, but queued behind others
- `vector-pick-sweep` (every 2 min): 62–793s elapsed, fanning out to 64 tickers

Each cron individually respects concurrency guards (overlap lock, bounded pool, background sweep tagging), but **these work at CONCURRENCY level, not RPS level**. The shared GLOBAL_MAX_RPS ceiling becomes the bottleneck.

## Investigation Needed

**Before considering GLOBAL_MAX_RPS bump to 5+ or 6+:**

1. **Transience check:** Is this peak-RTH-specific (self-resolves after market open settles)? Pull CloudWatch `[uw] queue wait` and `[cron/vector-pick-sweep] done` data from a full trading day (market open, mid-session, afternoon) to confirm the pattern.

2. **Fan-out impact:** Does vector-pick-sweep's 64-ticker fan-out compound the issue? Measure queue-wait per ticker and total. If 64 × 10s queue = 640s total, then fan-out throttling (async-pool limiting to N concurrent UW calls) might be a more surgical fix than raising RPS.

3. **Provider headroom:** Confirm UW's advertised rate limit is higher than 6 RPS (PR #5579 assumed it was ≥4, but that was unverified). Contact UW provider if unsure.

4. **Alternative fixes to consider:**
   - Add internal throttling to `vector-pick-sweep` using `runUwPool` with smaller `MAX_CONCURRENCY` (e.g., 2 instead of 3)
   - Stagger cron schedules to reduce peak-hour overlap (requires EventBridge rule coordination)
   - Request provider-side rate-limit increase if confirmed as a genuine bottleneck

## Decision Gate

**Do NOT increase GLOBAL_MAX_RPS further without:**
- Evidence that queue saturation persists mid-day (not just market open)
- Confirmation that provider plan supports the increase
- Comparison with fan-out throttling as an alternative

Raising the global ceiling affects ALL UW consumers and risks oversubscribing the actual provider plan limit. The cron-specific fan-out throttling is safer because it's localized to one consumer.

## Next Steps

1. Pull fresh CloudWatch data for a full trading day
2. Analyze queue-wait distribution (per-cron, per-ticker)
3. Decide: RPS bump vs. fan-out throttling vs. cron stagger
4. If fan-out throttling chosen: implement and validate in a follow-on PR
5. If RPS bump needed: confirm provider headroom first, then propose

## Files Changed

- None yet (this is an investigation finding, not a code fix)
