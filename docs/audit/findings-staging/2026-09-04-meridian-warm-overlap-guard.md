# 2026-09-04 — meridian-warm overlap guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/meridian-warm/route.ts` |
| **Status** | FIXED in PR |

## Root cause

`meridian-warm` lacked the cross-replica `sharedCacheSetNx` overlap guard already shipped on sibling warm crons (`desk-warm`, `zerodte-warm`, `heatmap-warm`). It shares the same ~5min EventBridge schedule band as those routes (FINDINGS 2026-09-02 ALB tail-latency chain), so concurrent invocations on multiple web-tier replicas could fan out the same Polygon/UW-bound warm work simultaneously.

## Fix

Added `OVERLAP_LOCK_KEY = "meridian-warm:running"` with 600s TTL (matches `stale_after_min: 10`), acquire-before-dispatch, idempotent skip on lost race, `finally` release, fail-open on Redis error — same pattern as `desk-warm`.

## Evidence

- `src/app/api/cron/meridian-warm/route.test.ts` — 5/5 pass
- `npx tsc --noEmit` clean
