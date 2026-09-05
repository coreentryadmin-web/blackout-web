# Cache freshness future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | SPX desk / tier auth / session hydration |
| **Branch** | `fix/cache-freshness-future-timestamp-guards` |

## Symptom

Five in-memory/session caches used raw `Date.now() - at < ttl` (or `> maxAge`) without rejecting clock-skewed future `at` stamps. A future timestamp yields negative age, which always passes the TTL check — stale tier entitlements, desk/play hydration, option tickets, and playbook technicals could read as infinitely fresh.

## Root cause

The 2026-09-05 freshness sweep fixed provider/Redis memo paths and the SPX 0DTE **quote** cache, but left sibling caches on the same pattern: `tier-cache.ts`, `session-cache.ts`, SPX play **ticket** cache, playbook technicals, and lotto ticket cache.

## Fix

Replace raw age arithmetic with `isWsUpdatedAtFresh(at, ttlMs, now)` from `src/lib/ws/timestamp-freshness.ts` (5s future tolerance, same as UW halt and heatmap overlays).

## Evidence

Source-scan regression tests:
- `src/lib/tier-cache-freshness.test.ts`
- `src/lib/session-cache-freshness.test.ts`
- `src/features/spx/lib/spx-play-options-freshness.test.ts` (ticket path)
- `src/features/spx/lib/spx-play-technicals-freshness.test.ts`
- `src/features/spx/lib/spx-lotto-options-freshness.test.ts`

## Blast radius

- Tier fast path + Clerk-outage stale fallback
- SPX desk/play rail sessionStorage hydration (`useMergedDesk`, play rail)
- SPX play option ticket selection during RTH
- Playbook matcher technicals (OR/RSI/MTF)
- Lotto play ticket generation
