# 2026-09-05 — GEX cross-validation UW ladder cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `gex-cross-validation.ts` UW ladder in-process cache |
| **Status** | FIXED |

## Symptom

`getUwStrikeLadder()` admitted cache hits via `Date.now() - entry.cachedAt < CACHE_TTL_MS`. When `cachedAt` is sourced from `ws.updatedAt` and clock-skewed into the future, negative age always satisfies `< 60_000`, serving a stale UW ladder as fresh for cross-validation on `/api/market/gex-heatmap` and `gex-positioning`.

## Root cause

Missed when #3834 introduced `gexHeatmapCacheEntryWithinTtl` for polygon-options-gex caches — the sibling in-process cache in gex-cross-validation kept the raw comparison.

## Fix

Route cache admission through `gexHeatmapCacheEntryWithinTtl(entry.cachedAt, now, CACHE_TTL_MS)`.

## Evidence

- Source-scan: `gex-cross-validation.test.ts`
- Pattern scan from hourly checklist (2026-09-05 autonomous wake)

## RTH validation

- During RTH, if UW `gex_strike_expiry` channel goes stale, cross_validation on Thermal/SPX matrix should not show spurious divergence from a clock-skewed cached ladder.
