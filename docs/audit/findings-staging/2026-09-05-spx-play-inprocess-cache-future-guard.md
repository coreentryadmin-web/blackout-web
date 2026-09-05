> **kind:** FINDING

# SPX play technicals + adaptive gates in-process caches shared clock-skew bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `spx-play-technicals.ts`, `spx-play-telemetry.ts` |

## Symptom

Two SPX play in-process cache-hit gates used raw `now - entry.at < ttlMs`, so a clock-skewed
future `at` read as negative age and served stale technicals or adaptive gates indefinitely —
same class as #3823 / #3844 / #3849 / #3856 (ticket/lotto).

## Fix

Route both gates through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from
`@/lib/ws/timestamp-freshness` (5s future tolerance).

## Evidence

- Source-scan regression: `spx-play-inprocess-cache-freshness.test.ts`

## Blast radius

Read-only cache admission on SPX play technicals/adaptive-gates paths — forces recompute
instead of serving untrustably future-dated entries.
