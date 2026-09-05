# 2026-09-05 — Polygon VIX IV rank + SPX 0DTE UW ladder cache future guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Polygon provider cache, SPX 0DTE UW ladder overlay |
| **Status** | FIXED |

## Symptom

Two in-process cache-hit gates still used raw `now - entry.at < ttlMs`, which treats clock-skewed future `at` stamps as infinitely fresh — same defect class fixed in #3823 / #3834 / #3839 / #3844.

## Root cause

- `fetchVixIvRankPercentile()` 5-minute VIX IV rank cache
- `getSpxOdteScopedUwLadderMap()` expiry-scoped UW ladder overlay cache

## Fix

Route both gates through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from `@/lib/ws/timestamp-freshness` (5s future tolerance).

## Evidence

- Source-scan regression: `cache-future-guard-polygon-uw-ladder.test.ts`

## RTH validation

- Poll `/api/market/spx/bootstrap` during RTH — VIX IV rank and matrix overlay should refresh normally (no stuck stale IV rank after a deploy clock skew event).
