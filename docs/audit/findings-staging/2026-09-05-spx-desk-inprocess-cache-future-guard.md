> **kind:** FINDING

# SPX desk in-process caches shared clock-skew bug — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P2 |
| **Area** | `spx-desk.ts` dark pool REST cache, prior-day OHLC, pulse structure |

## Symptom

Three SPX desk in-process cache-hit gates used raw `now - fetchedAt < ttlMs`, so a
clock-skewed future `fetchedAt` read as negative age and served stale dark pool prints,
prior-day OHLC, or pulse structure indefinitely — same class as #3823 / #3844 / #3849.

## Fix

Route dark pool, prior-day, and pulse-structure cache admission through shared
`isWsUpdatedAtFresh(fetchedAt, ttlMs, now)` (5s future tolerance).

## Evidence

- Source-scan regression: `spx-desk-inprocess-cache-freshness.test.ts`

## Blast radius

Read-only cache admission on SPX desk pulse/dark-pool/structure paths — forces recompute
instead of serving untrustably future-dated entries.
