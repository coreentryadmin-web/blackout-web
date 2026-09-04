## 2026-09-04 — [FINDING, P2 Performance] meridian-warm's `force=1` was the same unthrottled-replay gap as desk-warm (#3540) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/meridian-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`meridian-warm` had `OVERLAP_LOCK` but no `RERUN_COOLDOWN`. `force=1` bypasses the hours gate;
the overlap lock releases when the background warm settles, which on warm caches can be fast enough
that rapid replays fan out Polygon/UW-bound work faster than legitimate triggers (5 min heal
threshold / ~5 min EventBridge).

### Fix

`RERUN_COOLDOWN_KEY` with 120s TTL via atomic `sharedCacheSetNx`, checked before the overlap lock.
Fail-open on Redis error; cooldown not deleted early.

### Regression guard

`src/app/api/cron/meridian-warm/route.test.ts` — 7 tests including behavioral NX proof.
