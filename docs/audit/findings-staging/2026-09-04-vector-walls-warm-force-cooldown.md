## 2026-09-04 — [FINDING, P2 Performance] vector-walls-warm's `force=1` was the same unthrottled-replay gap as desk-warm/heatmap-warm — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/vector-walls-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`vector-walls-warm` already had `OVERLAP_LOCK`, but `force=1` bypassed `isEtCashRth()` with no minimum re-run floor once each background universe warm completed — the same structural gap #3540/#3542 fixed on desk-warm and heatmap-warm.

### Fix

`RERUN_COOLDOWN_KEY` (`vector-walls-warm:cooldown`) via atomic `sharedCacheSetNx`, checked before the overlap lock, 60s TTL. Fails OPEN on Redis error; key is never deleted early.

### Regression guard

`src/app/api/cron/vector-walls-warm/route.test.ts` — cooldown constant/key, ordering, skip response, no early delete.
