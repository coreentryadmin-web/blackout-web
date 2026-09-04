# 2026-09-04 — flow-liveness future timestamp false-fresh

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | `src/lib/flow-liveness.ts` |

## Symptom

`peekFlowLivenessHeartbeat`, `isFlowFrameFreshFromCluster`, and `isFlowFrameFreshAnywhere` used raw `Date.now() - record.at` for freshness. A future-skewed `record.at` (cross-replica clock drift) produced negative `ageMs`, which still satisfied `ageMs <= maxAgeMs` — reporting a stale/missing heartbeat as fresh.

## Fix

Clamp age with `Math.max(0, Date.now() - record.at)` before freshness comparison in all three paths. `age_sec` display already used `Math.max(0, …)` in peek; now uses the same clamped value consistently.

## Tests

`src/lib/flow-liveness.test.ts` — future timestamp → age_sec 0 + fresh; stale → not fresh.

## RTH validation

Admin System Vitals flow heartbeat age should never show negative seconds; cluster REST-skip gate should not trust a future-dated heartbeat as "fresh elsewhere."
