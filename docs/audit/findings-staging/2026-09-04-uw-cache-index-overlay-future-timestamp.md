> **kind:** FINDING

# UW L1 cache + index WS overlay: future timestamp reads as infinitely fresh — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | `unusual-whales.ts` `readUwCache`, `index-snapshot-overlay.ts` |
| **Found** | 2026-09-04 pattern scan (hourly wake) |

## Symptom

`readUwCache()` used `Date.now() - fetchedAt` without a future guard. A clock-skewed
`fetchedAt` in the future makes `age` negative, so `age <= ttl` is always true — the L1
UW response cache never expires.

`overlayRestIndexWithWs` / `localWsIndexEntry` / `clusterWsIndexEntry` used the same raw
subtraction for WS freshness. A future `updatedAt` skips the stale branch and the overlay
is treated as live (quote route already had an explicit guard; these helpers did not).

## Fix

- `readUwCache`: reject `fetchedAt` beyond `WS_TIMESTAMP_FUTURE_TOLERANCE_MS`; clamp age
  with `Math.max(0, age)` before TTL/stale checks.
- Index overlay helpers: route freshness through `isWsUpdatedAtFresh()`.

## Evidence

- `src/lib/providers/index-snapshot-overlay.test.ts` — future `updatedAt` returns REST baseline.
- `src/lib/providers/unusual-whales.test.ts` — source scan on `readUwCache` guard.

## Blast radius

Any UW REST path served from the in-process L1 cache; SPX/VIX index WS overlays on quote
and desk surfaces that call `overlayRestIndexWithWs` / `resolveLiveIndexWsEntry`.
