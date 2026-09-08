# UW / flow / options WS future-timestamp freshness guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | ingest / admin health |
| **PR** | (this branch) |

## Symptom

UW WS channel freshness (`isUwChannelFresh`), options live-mark sync (`getLiveOptionMarkSync`), and admin `cluster_live` reporting used raw `Date.now() - timestamp <= maxAgeMs`. A clock-skewed **future** stamp yields a negative age, which still satisfies `<= maxAgeMs`.

Note: flow-liveness cluster heartbeat was already fixed on main in #3718 (`flowHeartbeatAgeMs` / `signalWindowAgeMs`).

## Fix

Route UW/options freshness **decisions** through `isWsUpdatedAtFresh` and age **reporting** through `wsUpdatedAtAgeMs` from `timestamp-freshness.ts`.

## Evidence

- Source-scan regression tests in `uw-socket-gate.test.ts`, `options-socket-gate.test.ts`
- `npx tsx --test` on touched test files
