# UW / flow / options WS future-timestamp freshness guard

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | ingest / admin health |
| **PR** | (this branch) |

## Symptom

Several WS freshness gates used raw `Date.now() - timestamp <= maxAgeMs`. A clock-skewed **future** stamp yields a negative age, which still satisfies `<= maxAgeMs`, so the channel reads as live when it should not.

Affected paths: `isUwChannelFresh`, flow-liveness cluster skip gates, `getLiveOptionMarkSync`, admin `cluster_live` reporting.

## Fix

Route all freshness decisions through `isWsUpdatedAtFresh` / `wsUpdatedAtAgeMs` from `timestamp-freshness.ts` (same guard already used by admin cron health and quote route).

## Evidence

- Source-scan regression tests in `flow-liveness-freshness.test.ts`, `uw-socket-gate.test.ts`
- `npx tsx --test` on touched test files
