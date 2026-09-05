# 2026-09-05 — UW market-flow 429 fallback + Vector SPY volume cache future-timestamp guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | UW flow-alerts 429 fallback cache, Vector SPY volume proxy |
| **Status** | FIXED |

## Symptom

Pattern scan found two remaining raw `now - fetchedAt/cachedAt` TTL gates missed by the 2026-09-05 freshness sweep:

- `unusual-whales.ts` `fetchMarketFlowAlerts` 429 fallback served `marketFlowCache` when `now - cachedAt <= MARKET_FLOW_MAX_STALE_MS`
- `vector-spy-volume.ts` per-bar and day-bars caches used raw subtraction for TTL

Future/skewed timestamps yield negative age → false-fresh indefinitely.

## Fix

Route both through shared `isWsUpdatedAtFresh()`.

## Evidence

- `npx tsx --test unusual-whales-cache-freshness.test.ts vector-spy-volume-freshness.test.ts`

## RTH validation

- Vector chart SPY volume overlay should refresh on new minute bars (not stick on stale volume after deploy clock skew)
- HELIX flow-alerts under UW 429 should not serve infinitely stale cache on rate-limit fallback
