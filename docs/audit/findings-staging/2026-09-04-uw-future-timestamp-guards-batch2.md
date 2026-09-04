# 2026-09-04 — UW socket stall + SPX GEX stale future-timestamp guards

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | UW WebSocket stall watchdog, SPX desk GEX stale pill |
| **Status** | FIXED |

## Symptom

Two paths still used raw `Date.now() - timestamp` without a future guard — a clock-skewed **future** stamp reads as infinitely fresh:

1. `isUwSocketStalled()` — OPEN socket with future `freshestMessageAt` never triggers reconnect.
2. `gexStaleFromAge()` — callers clamp with `Math.max(0, now - asof)` so future GEX `asof` → age `0` → `gex_stale: false`.

(`readUwCache` is covered on branch `fix/uw-cache-index-overlay-future-timestamp`.)

## Root cause

#3760 fixed LULD halt freshness and #3745 fixed UW channel freshness, but these two call sites were missed in the same sweep.

## Fix

- `isUwSocketStalled`: `!isWsUpdatedAtFresh(freshest, stallMs, now)` when a delivery timestamp exists.
- `gexStaleFromAge`: return `true` when `ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS`.

## Evidence

- `uw-socket-stall.test.ts`, `uw-socket-gate.test.ts`, `spx-desk-rounding-stale.test.ts`.

## RTH validation

- Admin System Vitals: UW socket stall tile should still reconnect on genuine silence (no false-positive storms).
- SPX desk: when GEX snapshot age is real (10–20s), GEX stale pill stays off; verify no regression on normal RTH ages.
