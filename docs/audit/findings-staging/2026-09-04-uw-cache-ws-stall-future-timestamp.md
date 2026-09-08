# 2026-09-04 — UW in-process cache + stocks/polygon stall watchdog future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | UW REST L1 cache, Massive stocks/polygon indices WS stall watchdogs |
| **Status** | FIXED |

## Symptom

Three paths still used raw `Date.now() - timestamp` without a future guard — a clock-skewed **future** stamp reads as infinitely fresh and never triggers cache miss or stall reconnect:

1. `readUwCache()` — in-process UW REST L1 cache; future `fetchedAt` → negative age → cache hit forever.
2. `startStocksWatchdog()` — stocks `A.*` + LULD feed stall detection; future `lastMessageAt` never exceeds `STOCKS_STALL_MS`.
3. Polygon indices watchdog — same failure class on `lastIndicesMessageAt` vs `INDICES_STALL_MS`.

## Root cause

#3760 / #3745 fixed UW channel freshness, LULD halt freshness, and UW socket stall, but these three siblings were missed in the same sweep.

## Fix

Route all three through `isWsUpdatedAtFresh` from `timestamp-freshness.ts` (same helper as `isUwSocketStalled`, `isLuldHaltSourceStaleForState`, etc.).

## Evidence

- `unusual-whales.test.ts` (readUwCache source scan)
- `polygon-stocks-stall-gate.test.ts` (stall watchdog source scans)

## RTH validation

- Admin System Vitals: stocks + indices sockets should still reconnect on genuine silence (no false-positive stall storms).
- UW-backed desk supplements (dark pool, flow) should still serve from cache during normal RTH; verify no regression when cache TTL is legitimately short (market-tide, net-flow).
