# Cluster health future-timestamp false-green — FIXED

> **kind:** FINDING

| **Status** | FIXED (pending merge) |
|------------|-------------------------|
| **Priority** | P1 |
| **Area** | socket-health / RTH validation |
| **PR** | fix/cluster-health-future-timestamp-guard |

## Symptom

`/api/cron/socket-health` and RTH open validation could report UW/Polygon/options cluster paths as **live** when Redis heartbeats or option mark timestamps were clock-skewed into the future. `Math.max(0, now - at)` clamped negative ages to `0`, which reads as "just now."

## Root cause

`buildUwClusterHealth`, `readPolygonClusterHealth`, and `readOptionsClusterHealth` in `socket-cluster-health.ts` used raw `Math.max(0, now - timestamp)` without the future guard already applied in `readClusterIndexSpot` and `isWsUpdatedAtFresh`.

## Fix

- Added `clusterHeartbeatAgeMs()` helper (returns `null` when timestamp is beyond `CLUSTER_SPOT_FUTURE_TOLERANCE_MS` in the future).
- Wired `buildUwClusterHealth` / polygon cluster liveness through `isWsUpdatedAtFresh`.
- Skip option marks with untrusted future `ts` when scanning Redis.

## Evidence

- `npx tsx --test src/lib/ws/socket-cluster-health.test.ts` — RED pre-fix on far-future cases, GREEN post-fix.

## RTH validation

At market open, force a synthetic future `uw:ws:last_msg_at` in a staging probe (or observe cross-replica skew) and confirm `socket-health` does **not** report `cluster_live: true` for that path.
