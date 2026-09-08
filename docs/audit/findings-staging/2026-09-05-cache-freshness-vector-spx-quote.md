# Cache freshness: Vector DTE walls memo + SPX 0DTE quote cache — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Vector GEX ladder / SPX play options |
| **PR** | (pending) |

## What was broken

`vector-dte-walls-server.ts` request-coalescing memo and `spx-play-options.ts` 0DTE quote cache used raw `now - entry.at < ttlMs`. Future `at` stamps (cross-replica clock skew) produce negative age → always pass TTL → stale per-expiry walls or option marks served indefinitely. Same class as #3823 / #3834 / #3839 / #3844.

## What changed

Both gates route through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from `@/lib/ws/timestamp-freshness` (5s future tolerance). Source-scan regression tests lock the pattern.

## RTH validation

- Vector `/vector` DTE toggle: per-expiry walls should recompute after memo TTL, not stick on skewed-future memo entries.
- SPX Open desk play chips: 0DTE premium marks should refresh on TTL, not serve stale quotes from clock-skewed cache keys.
