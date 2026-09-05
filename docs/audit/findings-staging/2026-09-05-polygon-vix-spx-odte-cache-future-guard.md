> **kind:** FINDING

# Polygon VIX IV rank + SPX ODTE UW ladder caches shared clock-skew bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `polygon.ts`, `spx-odte-uw-ladder.ts` |

## Symptom

`now - entry.at < ttlMs` on in-process cache-hit gates treats a future `entry.at` (cross-replica
clock skew) as negative age, which always satisfies `< ttlMs` and serves stale-but-"fresh" VIX IV
rank or SPX 0DTE UW ladder data indefinitely — same class as #3823 / #3834 / #3844.

## Fix

Route both cache-hit gates through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from
`@/lib/ws/timestamp-freshness` (5s future tolerance).

## Evidence

- Source-scan regression: `polygon-vix-cache-freshness.test.ts`, `spx-odte-uw-ladder-freshness.test.ts`

## Blast radius

Read-only cache admission on VIX IV rank fetch and SPX ODTE scoped UW ladder overlay — forces
recompute instead of serving untrustably future-dated entries.
