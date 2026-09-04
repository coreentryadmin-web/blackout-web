## 2026-09-04 — [FINDING, P2 Performance] meridian-warm + zerodte-warm `force=1` unthrottled replay gap — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/meridian-warm/route.ts`, `src/app/api/cron/zerodte-warm/route.ts` |
| **Status** | FIXED |

### Root cause

Same structural gap fixed on desk-warm (#3540) and heatmap-warm (#3542): `force=1` bypasses
`shouldRunCacheWarmer`, and `OVERLAP_LOCK` only prevents a second run while the first is in flight.
On warm caches the background dispatch can complete quickly, releasing the lock while nothing caps
how often `?force=1` can be replayed.

### Fix

`RERUN_COOLDOWN_KEY` via atomic `sharedCacheSetNx`, checked before overlap lock, 60s TTL (below
meridian-warm's 5min and zerodte-warm's 4min rth-warm-leader heal thresholds). Fail-open on Redis
error; cooldown key not deleted early.

### Regression guard

`meridian-warm/route.test.ts` and `zerodte-warm/route.test.ts` — source-shape + behavioral NX tests.

### Gates

`npx tsx --test` on both files · `npx tsc --noEmit` clean (Node 20).
