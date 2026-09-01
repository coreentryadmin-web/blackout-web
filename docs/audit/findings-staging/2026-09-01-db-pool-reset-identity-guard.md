## 2026-09-01 — [FIX, P2 reliability] `resetPoolForRetry` identity guard — concurrent callers no longer tear down a replaced pool — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Ops auto-fix issue #3257: `spx-evaluate` and `spx-issues-sync` flagged stale/failed by `cron-staleness-watchdog` during RTH (2026-09-01 ~14:05–14:12 UTC). |
| **Root cause** | A genuine RDS/PgBouncer connection blip (`timeout exceeded when trying to connect`) hit during market hours. `dbQuery`'s retry path called `resetPoolForRetry()` unconditionally, ending the shared module-level pool while unrelated concurrent callers (other crons, telemetry, error-sink) were still using the same `Pool` instance → `Cannot use a pool after calling end on the pool` and `fetch failed` cascades across `spx-evaluate`, `spx-issues-sync`, `flow-ingest`, etc. The underlying blip self-resolved within minutes; crons returned 200 once DB connectivity stabilized. |
| **Fix** | `resetPoolForRetry(failedPool?)` now only ends + nulls the singleton when `pool === failedPool` — the specific instance the retrying caller queried. A concurrent caller whose retry already replaced `pool` with a fresh instance no longer gets its new pool torn down by a stale reset. Complements the existing `isTransientPgError` pool-teardown retry (2026-08-31). |
| **Evidence** | CloudWatch `/ecs/blackout-production` 14:11 UTC burst: interleaved `timeout exceeded when trying to connect` + `Cannot use a pool after calling end on the pool` across 5+ subsystems. Post-blip forced runs: `spx-evaluate`/`spx-issues-sync` 200, watchdog `problem_keys: []`, `ops-collect` exit 0. `src/lib/db.test.ts` regression pins identity-guard wiring. |
| **Status** | FIXED |
