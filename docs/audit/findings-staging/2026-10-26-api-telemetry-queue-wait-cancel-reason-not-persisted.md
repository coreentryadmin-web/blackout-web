## `api-telemetry-persist.ts` silently dropped `queue_wait_ms`/`cancel_reason` on every persisted row — admin event-detail fallback read `null` even though the live call genuinely captured both

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Round-108 discovery-lane audit sweep (lesson (d): "a type field correctly populated by the caller but dead/unused in the callee") |
| **Scope** | `src/lib/api-telemetry-persist.ts` (`persistApiTelemetryEvent`, `fetchPersistedApiEvent`); `src/lib/db.ts` (`ensureSchema`'s `api_telemetry_events` CREATE TABLE) |

### Root cause

`api-telemetry-types.ts`'s `ApiCallEvent` carries two "Phase 1 instrumentation" fields —
`queue_wait_ms` (ms spent waiting for shared-rate-limiter admission before the HTTP call itself
started, e.g. `uw-rate-limiter.ts`'s `acquireSlot()`) and `cancel_reason` (why a request was
aborted, e.g. `"dossier_ticker_wall_timeout"`) — added specifically to diagnose incidents like the
UW/Anthropic rate-limiter queue-wait spikes documented inline in `providers/unusual-whales.ts` and
`providers/anthropic.ts` ("queue_wait_ms up to 19,460ms"/"18428ms"). `api-tracked-fetch.ts`
populates both correctly on every tracked fetch call, and `api-telemetry.ts`'s `recordApiCall`
correctly stores them on the live, in-memory `ApiCallEvent` (locked in by
`api-telemetry.test.ts`'s own "Phase 1 instrumentation" tests).

But the persistence side of this pipeline was never updated to match:
- `src/lib/db.ts`'s `api_telemetry_events` `CREATE TABLE` never had `queue_wait_ms`/
  `cancel_reason` columns added.
- `persistApiTelemetryEvent`'s `INSERT` statement never listed either column, so every persisted
  row silently dropped both fields (no error — the extra fields on the JS object are just never
  read).
- `fetchPersistedApiEvent`'s `SELECT *` mapping back into an `ApiCallEvent` never read either
  column either, so even if they had reached the table, the read path would still drop them.

**Blast radius:** the in-memory ring buffer (`events` array in `api-telemetry.ts`) is capped at
800 entries and is per-process — across 5 ECS replicas it fills and evicts fast. Once an event ages
out of that buffer, `src/app/api/admin/apis/events/[id]/route.ts` (the admin API-event detail
viewer) falls back to `fetchPersistedApiEvent`. An admin investigating a historical
rate-limited/cancelled call — exactly the incident-diagnosis workflow this instrumentation exists
for — would see `cancel_reason: null` and a missing `queue_wait_ms`, even though the live call
genuinely captured both. This directly undermines the standing performance/latency audit
mandate's own "tail-latency, not average" diagnosis discipline: a p99/queue-wait spike investigated
any time after the in-memory buffer has rotated loses the one piece of evidence (why/how long it
queued) that explains it.

### Fix

- `db.ts`: `ALTER TABLE api_telemetry_events ADD COLUMN IF NOT EXISTS queue_wait_ms INT` /
  `... cancel_reason TEXT` (idempotent, matches the file's existing `ADD COLUMN IF NOT EXISTS`
  convention for additive schema changes).
- `persistApiTelemetryEvent`: added `queue_wait_ms, cancel_reason` to the `INSERT`'s column list
  and `event.queue_wait_ms ?? null, event.cancel_reason ?? null` to its params — never fabricated
  as `0`/`""`, matching the type's own "null for callers with no shared-limiter concept, never
  fabricated" contract.
- `fetchPersistedApiEvent`: added both columns to the row type and the returned `ApiCallEvent`.

Deliberately scoped to only these two fields — `synthetic` (another optional `ApiCallEvent` field)
is also absent from the table/INSERT, but that field exists specifically to EXCLUDE an event from
latency aggregation, which only matters for the live in-memory aggregate computed in
`api-telemetry.ts`; it is not consulted by anything that reads a persisted row back, so leaving it
out of this fix's scope (a single-issue PR, per policy) is a deliberate, disclosed choice, not an
oversight.

### Regression test

New `src/lib/api-telemetry-persist.test.ts` (mocks `./db`'s `dbQuery`/`dbConfigured`, same
mock-module convention `admin-gex-health.test.ts` etc. already use):
1. `persistApiTelemetryEvent` carries `queue_wait_ms`/`cancel_reason` into the `INSERT` params.
2. Both persist as `null` (never fabricated) when the event has no value.
3. `fetchPersistedApiEvent` round-trips both fields from a persisted row.

### Verification

- RED→GREEN proof: `git stash push -- src/lib/api-telemetry-persist.ts src/lib/db.ts` (keeping the
  new test file in the working tree) reproduced the bug exactly — all 3 new tests failed (the
  INSERT params carried no `queue_wait_ms`/`cancel_reason` at all, and the fetched row read back
  `undefined`). Restoring the fix (`git stash pop`) turned all 3 GREEN.
- `node --import tsx --experimental-test-module-mocks --test src/lib/api-telemetry-persist.test.ts
  src/lib/api-telemetry.test.ts` (Node 20) — 7/7 pass.
- `node --import tsx --experimental-test-module-mocks --test src/lib/db.test.ts` (Node 20) —
  42/42 pass (the `api_telemetry_events` schema change doesn't disturb any existing `db.ts` test).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- `npx eslint src/lib/api-telemetry-persist.ts src/lib/api-telemetry-persist.test.ts src/lib/db.ts`
  — clean, no warnings.
