# 2026-09-05 — getIndexStoreStatus negative age on future timestamps

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 (ops freshness) |
| **Area** | `polygon-socket.ts` admin/worker health |
| **Status** | FIXED |

## Symptom

`getIndexStoreStatus()` reported `ageMs` via raw `Date.now() - updatedAt`. A clock-skewed future `updatedAt` yields negative age in admin tiles — reads as falsely fresh (same class as #3627/#3760 elsewhere).

## Fix

Route symbol `ageMs` through shared `wsUpdatedAtAgeMs()` (clamps negative skew to 0).

## Evidence

- `polygon-stocks-stall-gate.test.ts` source-scan guard.
- `timestamp-freshness.test.ts` already covers clamp behavior.
