## 2026-09-04 — [FINDING, P2 Performance] meridian-warm's `force=1` was the same unthrottled-replay gap as desk-warm (#3540) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/meridian-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`meridian-warm` (Meridian timeline + Polygon GEX + desk enrichment pre-warmer) already had a
cross-replica `OVERLAP_LOCK`, but that lock only guards against a second run starting while the
first is still in flight — it is released the instant the run completes. `force=1` bypasses
`shouldRunCacheWarmer`'s hours gate with nothing capping how often it could be replayed — the
exact structural gap #3540 fixed on `desk-warm` and #3542 fixed on `heatmap-warm`.

### Fix

Same pattern as #3540/#3542: a `RERUN_COOLDOWN_KEY` claimed via atomic `sharedCacheSetNx`,
checked before the overlap lock and before dispatch, 60s TTL (safely below rth-warm-leader's
5 min heal threshold and EventBridge's ~5 min schedule). Fails OPEN on Redis error.

### Regression guard

`src/app/api/cron/meridian-warm/route.test.ts` — 2 new tests (source-shape + behavioral NX proof).

### Gates

`npx tsc --noEmit` clean · `npx tsx --test src/app/api/cron/meridian-warm/route.test.ts` 7/7 pass
(Node 20.20.2).
