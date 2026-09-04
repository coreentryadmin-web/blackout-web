# Future timestamp freshness guard — flow-liveness / UW / options marks

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | HIGH |
| **Area** | flow-liveness, uw-socket, options-socket |
| **PR** | (pending) |

## Symptom

`Date.now() - updatedAt <= maxAgeMs` treats clock-skewed **future** timestamps as fresh (negative age still passes `<= maxAgeMs`). Affected:

- `isFlowFrameFreshFromCluster` / `isFlowFrameFreshAnywhere` / `peekFlowLivenessHeartbeat` — SPX desk flow liveness gates
- `isUwChannelFresh` — net_flow freshness in spx-desk
- `getLiveOptionMarkSync` — 0DTE option marks on hot paths

## Fix

Reuse existing `isWsUpdatedAtFresh` / `wsUpdatedAtAgeMs` from `src/lib/ws/timestamp-freshness.ts` (already used by quote route WS paths). Rejects timestamps more than 5s in the future; clamps display age to ≥0.

## Evidence

- `src/lib/flow-liveness-future-ts.test.ts` — future +10s → `fresh: false`; +4s within tolerance → fresh
- `src/lib/ws/timestamp-freshness.test.ts` — existing unit coverage for helper

## Market-open validation

At RTH open, confirm admin SPX health / flow liveness panel does not show "fresh" when heartbeat timestamp is absent or stale; 0DTE marks fall back to REST when WS mark ts is future-skewed.
