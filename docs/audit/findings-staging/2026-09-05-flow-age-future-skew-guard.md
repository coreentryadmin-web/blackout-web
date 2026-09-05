# Flow + cluster heartbeat future-skew fail-closed guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-flow-age-future-skew |
| **Priority** | P1 |
| **Area** | SPX play gates / socket-health |
| **Status** | FIXED (pending merge) |

## Symptom

Future-dated `alerted_at` on flow tape rows and future `cluster_last_message_at` / polygon snapshot timestamps clamped to age `0` via `Math.max(0, now - at)`, reading as infinitely fresh and bypassing staleness gates.

## Root cause

`newestFlowAgeMsFromBriefs()` and `buildUwClusterHealth()` / `readPolygonClusterHealth()` used raw `Math.max(0, now - timestamp)` without the future-skew tolerance already used elsewhere (`WS_TIMESTAMP_FUTURE_TOLERANCE_MS`, `isWsUpdatedAtFresh`).

## Fix

- `src/lib/flow-data-freshness.ts`: fail-closed null when tape age is future-skewed; `resolveFlowDataAgeMs` does not fall back to in-memory stamp when tape is future-skewed.
- `src/lib/ws/socket-cluster-health.ts`: `buildUwClusterHealth` + `readPolygonClusterHealth` use `isWsUpdatedAtFresh` / future tolerance for `cluster_live`.

## Evidence

`npx tsx --test src/lib/flow-data-freshness.test.ts src/lib/ws/socket-cluster-health.test.ts` — 16/16 pass (Node 20).

## Market-open validation

Monday RTH: confirm SPX desk `flow_data_age_ms` blocks when UW returns a future `alerted_at` (inject via sim if needed); `/api/cron/socket-health` must not show `cluster_live: true` on a future-skewed heartbeat.
