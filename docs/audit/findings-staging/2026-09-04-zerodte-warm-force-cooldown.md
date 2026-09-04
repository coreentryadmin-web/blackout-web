## 2026-09-04 — [FINDING, P2 Performance] zerodte-warm's `force=1` was the same unthrottled-replay gap as desk-warm/heatmap-warm — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/zerodte-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`zerodte-warm` had `OVERLAP_LOCK` only — `force=1` bypassed `shouldRunCacheWarmer`'s hours gate with no minimum re-run floor. A caller replaying `?force=1` could re-trigger the 0DTE scanner tick + board snapshot rebuild as fast as requests could be sent once each background pass completed.

### Fix

`RERUN_COOLDOWN_KEY` (`zerodte-warm:cooldown`) via atomic `sharedCacheSetNx`, checked before the overlap lock, 60s TTL (below rth-warm-leader's 4 min heal threshold and EventBridge's ~5 min schedule). Fails OPEN on Redis error; key is never deleted early.

### Regression guard

`src/app/api/cron/zerodte-warm/route.test.ts` — cooldown constant/key, ordering, skip response, fail-open, no early delete, behavioral NX refusal test.
