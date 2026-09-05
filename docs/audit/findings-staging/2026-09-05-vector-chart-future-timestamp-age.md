# VectorChart client dataAgeMs future-timestamp fail-closed — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-vector-chart-future-age |
| **Status** | FIXED |
| **PR** | (pending) |
| **Area** | Vector / play conviction staleness |

## Symptom

`VectorChart.tsx` computed `dataAgeMs` as `Math.max(0, Date.now() - dataReceivedAtMsRef.current)`. A clock-skewed **future** receive time clamped to age **0**, so `stalenessConvictionDiscount` applied no penalty — the play read as freshly measured when the timestamp was untrusted.

## Root cause

PR #3983 fixed the same defect server-side in `vector-full-state.ts` and Night Hawk `eventAgeMs`, but the Vector chart client path still used naive `Math.max(0, …)`.

## Fix

- Added shared `dataAgeMsFromEpoch()` in `src/lib/ws/timestamp-freshness.ts` (mirrors `withReadContext` guard).
- `VectorChart` now passes `dataAgeMsFromEpoch(dataReceivedAtMsRef.current)` into `buildVectorPlay`.
- Unit tests in `timestamp-freshness.test.ts` + source-scan ratchet in `vector-chart-viewport.test.ts`.

## Blast radius

Client-side Vector play conviction only. Server BIE path already fail-closed.

## RTH validation

On Vector desk during RTH: if stream `dataReceivedAt` is sane, behavior unchanged. Future-skewed stamps should show reduced conviction / STALE badge path via `POSITIVE_INFINITY` discount.
