> **kind:** FINDING

## Vector universe scanner collapses to viewed tickers off-hours — FIXED

| **Status** | FIXED (PR pending) |
|------------|-------------------|

**Symptom:** Saturday live probe of `GET /api/market/vector/universe` returned only 2 rows (NVDA, IWM) while SPX/SPY/QQQ heatmaps were available and platform-integrity passed.

**Root cause:** `vector-universe-snapshot` cron is RTH-gated; `UNIVERSE_ROW_MAX_AGE_MS` (15m) expires rows between runs. The universe route only rebuilt on a full cache miss, so a depleted snapshot (append-only via `ensureTickerInUniverseSnapshot`) was served as truth.

**Fix:** `isDepletedUniverseSnapshot()` — when SPX/SPY/QQQ are absent, trigger `refreshVectorUniverseSnapshot()` (Polygon cache-reader fan-out, no wall recording).

**Evidence:** Live prod 2026-09-05 16:59 UTC — universe `rows=2`, gex-heatmap SPX/SPY/QQQ all HTTP 200 with spot.

**Test:** `src/features/vector/lib/vector-universe-merge.test.ts` (`isDepletedUniverseSnapshot`)
