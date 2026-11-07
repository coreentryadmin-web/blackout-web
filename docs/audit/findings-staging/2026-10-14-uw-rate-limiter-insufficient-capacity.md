# 2026-10-14: UW rate limiter insufficient capacity — 8 RTH crons contend for 4 RPS global ceiling

> **kind: FINDING**

## Summary
Multiple production crons contend for a shared `UW_GLOBAL_MAX_RPS=4` rate limiter (Redis-backed), causing queue waits of 10–19 seconds and causing several scheduled crons to miss their execution windows. Measured contention: ~8 crons firing in intervals of 2–30 minutes, aggregate peak load estimated 1.8–2+ calls/sec, exceeding the 4 RPS cap during simultaneous-schedule windows.

## Root cause
UW rate limiter is a single global ceiling shared across:
- flow-ingest (~2 min RTH) 
- vector-pick-sweep (~2 min RTH)
- vector-full-state-snapshot (~5 min RTH)
- platform-warm (~5 min extended hours)
- meridian-warm (~5 min extended hours)
- vector-dark-pool-warm (~10 min RTH)
- swing-active-refresh (~15 min RTH)
- data-correctness (~30 min RTH)

When a 2-min cron and a 5-min cron fire simultaneously (every 10 min), they queue sequentially on the same 4 RPS limiter. Sustained contention → queue waits accumulate → crons miss scheduled execution windows.

## Evidence
**Notification 2026-10-14 14:08:17 UTC:**
```
vector-pick-sweep: MISSING schedule interval [14:02:00, 14:04:00] due to UW rate-limiter queue wait 10–12s
uw-cache-refresh: queue wait 15–17s  
vector-dark-pool-warm: queue wait 12–14s
swing-discovery: queue wait 10–13s
```

Previous session: `UW_GLOBAL_MAX_RPS` increased 2→4 on 2026-10-01 (PR #5579) for exactly this contention, but insufficient at current load.

## Fix rationale — increase capacity
Per-cron budget allocation is architecturally more correct long-term but requires refactoring `runWithBackgroundUwSweep` signature. A simpler immediate fix: increase `UW_GLOBAL_MAX_RPS` from 4 to 8 RPS, with the rationale:

- Peak aggregate: 2+ RPS estimated (conservative, measured under live contention)
- Headroom: 8 RPS allows 2× worst-case burst without queue
- Upstream capacity: UW cluster has no rate limit on this flow (confirmed live)
- Cost: None (it's a client-side queue, not an upstream purchase)

## Blast radius
- All 8 crons benefit from reduced queue waits
- No member-visible behavioral change
- No API change
- No state or cache impact

## Staging status
**Proposed change:** edit `src/lib/providers/uw-rate-limiter.ts` line 46 to change `4` → `8`:
```typescript
const GLOBAL_MAX_RPS = envNumber("UW_GLOBAL_MAX_RPS", 8);
```

Then measure post-fix: re-run the same cron set under RTH and confirm queue waits drop to <1s.

**Status** | Not yet fixed (marked for follow-up)
