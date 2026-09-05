# Vector snapshot in-process caches — future timestamp false-fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-vector-snapshot-freshness |
| **Status** | FIXED |
| **Area** | Vector GEX/VEX walls, gamma flip, stream hub |
| **PR** | (pending) |

## Symptom

Vector wall rail, VEX walls, gamma-flip overlay, and stream-hub background refresh gates used raw `Date.now() - at < TTL`. A future `at` stamp (clock skew, `fallbackFetchedAt` from a prior fetch) yields negative age, which always passes the TTL check — caches never recompute until the skewed timestamp ages out.

## Root cause

`vector-snapshot.ts` lines 187, 228, 243, 289, 445, 676, 685: raw subtraction freshness gates. Sibling path `vector-dte-walls-server.ts` was fixed in the 2026-09-05 freshness sweep (#3872 wave) but this in-process memo layer was missed.

## Fix

Route all gates through `isWsUpdatedAtFresh()` from `@/lib/ws/timestamp-freshness` (same pattern as SPX play caches, vector-dte-walls-server, live-marks active set).

## Evidence

Regression test: `src/features/vector/lib/vector-snapshot-cache-freshness.test.ts` — source scan asserts `isWsUpdatedAtFresh` usage and absence of raw `now - s.cached*At` patterns.

## Market-open validation

On Vector desk during RTH: toggle GEX/VEX lens and DTE horizon — wall nodes and gamma-flip line should refresh within expected TTL after a forced heatmap turnover (`?force=1` on gex-heatmap for SPY). No indefinitely-stale age chip on walls after provider recovery.
