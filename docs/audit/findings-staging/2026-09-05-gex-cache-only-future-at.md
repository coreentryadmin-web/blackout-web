# readGexHeatmapCacheOnly served future-skewed cache as fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-gex-cache-only-future-at |
| **Priority** | P2 |
| **Area** | GEX / 0DTE thesis evidence |
| **Status** | FIXED |

## Symptom

`readGexHeatmapCacheOnly` (0DTE thesis evidence bundle scan path) used raw `now - entry.at > maxStaleMs` to decide staleness. A clock-skewed future `entry.at` yields negative age, which never exceeds `maxStaleMs`, so the entry is served as fresh indefinitely — the same failure class fixed across sibling caches in #3834.

## Root cause

`polygon-options-gex.ts` `readGexHeatmapCacheOnly` line ~3971: raw age comparison instead of shared `gexHeatmapCacheEntryStale()` helper that already guards future timestamps beyond `GEX_WS_FUTURE_TOLERANCE_MS`.

## Fix

Route the cache-only reader through `gexHeatmapCacheEntryStale(entry.at, now)`; static regression test pins the source shape.

## Evidence

- `npx tsx --test src/lib/providers/polygon-options-gex.test.ts` — new test `readGexHeatmapCacheOnly: rejects future-skewed entry.at via gexHeatmapCacheEntryStale` passes; fails pre-fix.
