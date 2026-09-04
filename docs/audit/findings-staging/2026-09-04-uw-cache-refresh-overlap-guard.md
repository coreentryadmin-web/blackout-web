# 2026-09-04 — uw-cache-refresh overlap guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P1 performance |
| **Surface** | `src/app/api/cron/uw-cache-refresh/route.ts` |
| **Status** | FIXED in PR |

## Root cause

`uw-cache-refresh` lacked the cross-replica `sharedCacheSetNx` overlap guard already shipped on sibling warm crons (`desk-warm`, `meridian-warm`, `vector-walls-warm`). It fires every **2 min** RTH and is on `rth-warm-leader`'s heal list, so concurrent invocations on multiple web-tier replicas could stack ~24 parallel UW REST tasks and threaten the **120/min plan cap** this cron exists to protect.

## Fix

Added `OVERLAP_LOCK_KEY = "uw-cache-refresh:running"` with 600s TTL (matches `stale_after_min: 10`), acquire-after-sync-pulse-seed, idempotent skip on lost race, `finally` release, fail-open on Redis error. Sync WS seed + pulse snapshot still run on every fire (cheap and safety-critical).

## Evidence

- `src/app/api/cron/uw-cache-refresh/route.test.ts` — 6/6 pass
- `npx tsx --test src/app/api/cron/uw-cache-refresh/route.test.ts` clean
