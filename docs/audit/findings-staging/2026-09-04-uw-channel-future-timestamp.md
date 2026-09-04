# UW channel freshness false-fresh on future timestamps — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-uw-channel-future-ts |
| **Priority** | P1 |
| **Area** | `src/lib/ws/uw-socket.ts` |
| **Status** | FIXED |

## Symptom

`isUwChannelFresh()` and `getUwSocketHealth().cluster_live` used raw `Date.now() - at` without a future-timestamp guard. A clock-skewed `lastMessageAt` in the future yields negative age, which always satisfies `<= maxAgeMs`, so UW channels read as live when REST fallback should run.

## Root cause

`isUwChannelFresh` (line ~1640) and `getUwSocketHealth` cluster age (line ~1661) predated the shared `isWsUpdatedAtFresh` helper in `timestamp-freshness.ts`.

## Fix

- Route `isUwChannelFresh` through `isWsUpdatedAtFresh`.
- Route `getUwSocketHealth` ages through `wsUpdatedAtAgeMs` and `cluster_live` through `isWsUpdatedAtFresh`.
- Halt-source staleness proxy (`isUwHaltSourceStale`) uses the same guard.

## Evidence

- `src/lib/ws/uw-channel-freshness.test.ts` — future timestamp beyond 5s tolerance → `isUwChannelFresh` false, `cluster_live` false.

## Blast radius

`flow-ingest` REST skip, `uw-ws-cache-bridge` task skips, `gex-cross-validation` UW ladder freshness, admin UW health tiles.
