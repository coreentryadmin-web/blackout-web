# Flow liveness heartbeat future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | flow-ingest / admin health |
| **PR** | (this branch) |

## Symptom

`isFlowFrameFreshFromCluster`, `isFlowFrameFreshAnywhere`, and `peekFlowLivenessHeartbeat` used raw `Date.now() - record.at <= maxAgeMs`. A far-future heartbeat timestamp yields a negative age that trivially passes the freshness gate, letting flow-ingest skip REST and admin health report "fresh" when the cluster WS is actually stale.

## Root cause

The cluster flow heartbeat (`flow-liveness.ts`) never routed through the shared `signalWindowAgeMs` future-print guard already used by `probePgFlowAlertsFresh` and cron writer-target probes.

## Fix

Route all three reads through exported `flowHeartbeatAgeMs()` → `signalWindowAgeMs()`. Far-future timestamps return `null` age → `fresh: false`.

## Evidence

`src/lib/flow-liveness.test.ts` — future +5m timestamp returns `null`; normal past age passes.

## Market-open check

Admin → Operations → confirm flow WS tile does not show fresh when ingest is intentionally idle off a corrupted/future heartbeat (normal RTH: tile tracks live frames within 120s).
