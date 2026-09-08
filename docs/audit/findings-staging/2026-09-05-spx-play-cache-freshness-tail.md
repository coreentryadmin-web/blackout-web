# SPX play-path in-process caches — future-at guard tail sweep — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | SPX play ticket / lotto / adaptive gates / technicals |
| **PR** | (pending) |

## What was broken

Four remaining SPX play-path in-process caches still used raw `now - entry.at < ttlMs`. Future `at` stamps (cross-replica clock skew) produce negative age → always pass TTL → stale option tickets, lotto picks, adaptive gate boosts, or technicals served indefinitely. Same class as #3849 / #3844 cache-freshness sweep.

## What changed

Route all four gates through shared `isWsUpdatedAtFresh(at, ttlMs, now)` from `@/lib/ws/timestamp-freshness` (5s future tolerance):

- `spx-play-options.ts` — `ticketCache` (45s)
- `spx-lotto-options.ts` — `lottoTicketCache` (60s)
- `spx-play-telemetry.ts` — adaptive gates cache (5m)
- `spx-play-technicals.ts` — playbook technicals cache

Source-scan regression tests lock each pattern.

## RTH validation

- SPX Open desk: play ticket premium/delta should refresh on TTL after deploy skew, not stick on a clock-skewed memo entry.
- Lotto rail: lotto strike/premium should recompute when cache TTL expires.
- Adaptive gates banner: outcome-driven score boosts should refresh within 5m, not stick forever on skewed `at`.
