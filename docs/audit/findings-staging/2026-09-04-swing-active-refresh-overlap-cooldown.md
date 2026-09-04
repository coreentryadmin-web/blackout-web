## 2026-09-04 — [FINDING, P2 Performance] swing-active-refresh had no cross-replica overlap guard or re-run floor — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/swing-active-refresh/route.ts` |
| **Status** | FIXED |

### Root cause

Unlike sibling RTH crons (desk-warm, meridian-warm, zerodte-warm, vector-walls-warm), `swing-active-refresh` dispatched its Polygon/UW + DB refresh in `after()` with **no** `sharedCacheSetNx` overlap lock and **no** minimum re-run cooldown. Duplicate EventBridge fires or rth-warm-leader heal dispatches could fan out concurrent refreshes across web-tier replicas.

### Fix

Added `OVERLAP_LOCK_KEY` (`swing-active-refresh:running`, 600s TTL) checked before dispatch, released in the background `finally`. Added `RERUN_COOLDOWN_KEY` (60s floor) checked before the overlap lock. Both fail OPEN on Redis error.

### Regression guard

`src/app/api/cron/swing-active-refresh/route.test.ts` — overlap lock, cooldown ordering, skip responses, fail-open, finally release, TTL.
