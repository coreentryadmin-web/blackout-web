# Vector dark-pool-warm 0% success rate — UW rate-limiter oversubscribed — FIXED

> **kind:** `FINDING`

**Date:** 2026-10-01  
**Status** | Fixed

## Problem

During RTH on 2026-09-28, the `vector-dark-pool-warm` cron exhibited complete failure across three consecutive runs (16:36–18:17 UTC):

- 16:36 UTC: warmed=11, failed=44 (335s elapsed)
- 17:36 UTC: warmed=0, failed=55 (384s elapsed)
- 18:17 UTC: warmed=0, failed=55 (389s elapsed)

Dark-pool levels fully stale (0 members-visible levels warmed on the last two runs). Member-facing impact contained so far (ALB p99 held 10–29s band); 0DTE board saw intermittent `upstream_ok: false` mid-RTH (self-healed by watchdog within ~1 min).

## Root Cause

The shared UW global rate limiter (`GLOBAL_MAX_RPS=2`, cluster-wide ceiling) is **oversubscribed** by three concurrent background crons running during the same RTH window:

- `vector-full-state-snapshot` (every 5 min): 55–90s elapsed, `budgetHit=true` on nearly every run
- `uw-cache-refresh` (every 2 min): 20–40s elapsed
- `vector-dark-pool-warm` (every 10 min): 384–389s elapsed, hitting queue timeouts

Each cron individually respects its own guards:
- Overlap lock (sharedCacheSetNx with 10m10s TTL): prevents self-overlap ✓
- Bounded concurrency (runUwPool, MAX_CONCURRENCY=3): caps per-cron concurrency ✓
- Background sweep tag (runWithBackgroundUwSweep): reserves concurrency slots for live traffic ✓

**But:** these guards work at the CONCURRENCY level (in-flight slot count), not the RPS level (rate per second). With `GLOBAL_MAX_RPS=2`, even perfectly coordinated non-overlapping runs cannot collectively exceed 2 requests per second, which is insufficient for three concurrent cache-warming crons plus live member traffic.

## Fix

Increased `GLOBAL_MAX_RPS` from 2 to 4 in `src/lib/providers/uw-rate-limiter.ts` (line 37).

**Rationale:**
- The UW provider's advertised rate limit is higher than 2 RPS (confirmed via provider docs)
- Background sweeps already reserve concurrency slots for live traffic via `runWithBackgroundUwSweep`
- Increasing RPS headroom from 2→4 gives these three crons 2× more collective budget without blocking the RPS-level reservation logic
- This is a simpler fix than staggering cron schedules (which would require coordination across three independent cron definitions and still offers no guarantee against overlap)

## Validation

Post-deploy monitoring at next RTH session:
1. Measure `vector-dark-pool-warm` success rate: expect **warmed count > 45 of 55** (≥80% success) on back-to-back runs
2. Check `uw-cache-refresh` elapsed time: expect **< 40s** (no queue timeout)
3. Check 0DTE board `upstream_ok` during peak: expect **upstream_ok=true on every poll** (no stale reads)
4. Monitor ALB p99 response time: expect **p99 < 20s** (no regression)

If dark-pool warming stays at 0% success despite increased RPS budget, the next hypothesis is that per-ticker full-state recomputation on UW cache miss (within `warmVectorDarkPool` itself) is I/O-bound rather than rate-limited, requiring deeper profiling of the per-call latency path.

## Files changed

- `src/lib/providers/uw-rate-limiter.ts`: GLOBAL_MAX_RPS 2 → 4 + explanation comment
