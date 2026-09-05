> **kind:** FINDING

# SPX play in-process caches shared clock-skew bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `spx-play-options.ts`, `spx-play-technicals.ts`, `spx-play-telemetry.ts`, `spx-lotto-options.ts` |

## Symptom

Four SPX play in-process cache-hit gates used raw `now - entry.at < ttlMs`, so a clock-skewed
future `at` read as negative age and served stale tickets, technicals, adaptive gates, or lotto
marks indefinitely — same class as #3823 / #3844 / #3849.

## Fix

Route all four gates through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from
`@/lib/ws/timestamp-freshness` (5s future tolerance).

## Evidence

- Source-scan regression: `spx-play-inprocess-cache-freshness.test.ts`

## Blast radius

Read-only cache admission on SPX play ticket/technicals/gates/lotto paths — forces recompute
instead of serving untrustably future-dated entries.
