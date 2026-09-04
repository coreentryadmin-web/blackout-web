## 2026-09-04 — [FINDING, P2 Performance] zerodte-warm's `force=1` was the same unthrottled-replay gap as desk-warm (#3540) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/zerodte-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`zerodte-warm` (0DTE Command scanner tick + board-snapshot rebuild) had a cross-replica
`OVERLAP_LOCK` but no minimum re-run floor. `force=1` bypasses `shouldRunCacheWarmer`'s hours
gate; the overlap lock releases when the background dispatch settles, which can be fast on an
already-warm board. Same structural gap fixed on `desk-warm` (#3540) and `heatmap-warm` (#3542).

### Fix

`RERUN_COOLDOWN_KEY` via atomic `sharedCacheSetNx`, checked before the overlap lock, 60s TTL
(below rth-warm-leader's 4 min heal threshold and EventBridge's ~5 min schedule). Fails open on
Redis error. Key is never deleted early.

### Regression guard

`src/app/api/cron/zerodte-warm/route.test.ts` — 2 new tests (source-shape + behavioral NX proof).
