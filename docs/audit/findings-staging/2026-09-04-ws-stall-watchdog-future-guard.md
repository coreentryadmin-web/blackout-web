# Stocks/polygon WS stall watchdog future-timestamp guards — FIXED

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 |
| **Area** | Massive stocks + polygon indices WS stall watchdogs |
| **PR** | (pending) |

## Symptom

Two stall watchdog paths still used raw `Date.now() - timestamp` without a future guard — clock-skewed **future** `lastMessageAt` stamps read as infinitely fresh and never trigger reconnect:

1. `startStocksWatchdog()` — stocks `A.*` + LULD feed stall detection.
2. Polygon indices watchdog — `lastIndicesMessageAt` vs `INDICES_STALL_MS`.

## Root cause

#3760 / #3762 / #3771 fixed UW channel freshness and index overlay guards, but these two Massive socket stall siblings were missed.

## Fix

Route both through `isWsUpdatedAtFresh` from `timestamp-freshness.ts`.

## Regression test

`src/lib/ws/polygon-stocks-stall-gate.test.ts` — source scans on both watchdog functions.

## Market-open validation

Admin System Vitals: stocks + indices sockets should still reconnect on genuine silence (no false-positive stall storms).
