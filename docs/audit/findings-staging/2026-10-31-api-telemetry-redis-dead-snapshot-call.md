# 2026-10-31 api-telemetry-redis.ts: `buildInstancePayload()` computed a full `getApiTelemetrySnapshot()` and threw the result away

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 dead computation / wasted work on a hot on-demand path |

## Root cause

`buildInstancePayload()` in `src/lib/api-telemetry-redis.ts` (the per-instance payload builder
`flushTelemetryToRedis()` calls on every on-demand flush) opened with:

```ts
function buildInstancePayload(): InstanceTelemetryPayload {
  const snap = getApiTelemetrySnapshot(5 * 60_000);
  const health = getProviderHealthSummary(5 * 60_000);
  ...
```

`snap` was never read again anywhere in the function or the file — the actual returned
`InstanceTelemetryPayload` (`instance_id`, `updated_at`, `rate_limits`, `providers`) is built
entirely from `health` (`getProviderHealthSummary()`'s own `by_provider`/`rate_limits`), never
from `snap`. Repo-wide grep confirmed `getApiTelemetrySnapshot` had exactly one call site in
this file (the dead one) and was otherwise imported directly from `@/lib/api-telemetry` by every
real consumer (`admin-api-dashboard.ts`, `market-health.ts`, `admin-endpoint-registry.ts`, the
admin APIs SSE stream route, and `api-telemetry.test.ts`) — none of them go through
`api-telemetry-redis.ts` for it.

`getApiTelemetrySnapshot()` is not a cheap no-op to call and discard: it filters the entire
in-memory event ring buffer by the time cutoff, re-derives per-provider call/error counts from
that filtered set, then rebuilds and sorts a per-provider `endpoints` array by walking the whole
`endpointStats` map (see `src/lib/api-telemetry.ts:304-354`). `buildInstancePayload()` is called
from `flushTelemetryToRedis()`, which `admin-api-dashboard.ts` and `market-health.ts` invoke
on-demand, per-request (not on a timer — the scheduler that would have called it periodically
was itself already removed as dead code, see #889 / the sibling `clearTelemetryRedisFlush`
finding from earlier today). So every one of those on-demand flushes was paying the full cost of
that scan-and-sort twice over: once for `health` (whose `getProviderHealthSummary()` internally
also calls `getApiTelemetrySnapshot`) and a second, fully redundant time for the discarded `snap`.

## Why this wasn't caught earlier

The line type-checks cleanly (`snap` has a real, used-elsewhere type) and has no externally
observable side effect — `getApiTelemetrySnapshot` is a pure read of in-memory state, so calling
it and discarding the result changes nothing any existing test or caller could assert against.
It most likely came from an earlier version of `buildInstancePayload()` that did read `snap` for
some field later refactored onto `health` instead, leaving the fetch itself behind — the same
half-finished-refactor shape as the `clearTelemetryRedisFlush`/`flushTimer`/`FLUSH_MS` leftovers
fixed earlier in this file today (PR #7019), just missed by that pass because it isn't a
dead *export* (nothing re-exports `snap`) — it's a dead *local* inside a still-live function, a
different shape of drift the prior cleanup's grep-for-callers method wouldn't surface.

## Evidence

- `grep -rn "getApiTelemetrySnapshot"` across `src/` (against a freshly-fetched `origin/main`,
  post-#7019): exactly one call site inside `api-telemetry-redis.ts` (the dead one, at the old
  line 71/74 depending on pre/post #7019's edits to the same file), plus five genuinely-live call
  sites elsewhere (`admin-api-dashboard.ts`, `market-health.ts`, `admin-endpoint-registry.ts`,
  `src/app/api/admin/apis/stream/route.ts`, `api-telemetry.test.ts`) — all importing it directly
  from `@/lib/api-telemetry`, never through this file.
- Read `getApiTelemetrySnapshot`'s body (`api-telemetry.ts:304-354`): confirmed pure (filters
  `events`, re-derives counts, sorts `endpointStats` entries, returns a fresh object) — no shared
  mutable state written, so discarding its result has zero side effect to preserve.
- RED→GREEN via `git stash` on `api-telemetry-redis.ts` alone: the new source-text regression
  test fails against the pre-fix file (`snap`/import present) and passes post-fix; `git stash
  pop` restored the fix. Full local suite for this file + its two direct siblings
  (`api-telemetry.test.ts`, `api-telemetry-persist.test.ts`) plus the pre-existing
  `api-telemetry-redis.test.ts`: 10/10 pass on Node 20. `tsc --noEmit` and `eslint` clean on both
  touched files.

## Blast radius

Single call site, single file. No other file imports `getApiTelemetrySnapshot` from
`api-telemetry-redis.ts` (it was never re-exported), so no consumer-side change is needed.
`buildInstancePayload()`'s return value is unchanged — same fields, same values — this removes
only work that never reached that return value.

## Fix rationale

Deleted the `const snap = getApiTelemetrySnapshot(5 * 60_000);` line and the now-unused
`getApiTelemetrySnapshot` import (the file's second import, `getProviderHealthSummary`, is still
used and left untouched). Did not attempt to route any of `snap`'s fields
(`recent_events`/`recent_errors`/`active_retries`) into the cross-instance payload instead —
round 154's trace already established the one real consumer of those fields
(`admin-api-dashboard.ts`) sources them from its **own** direct, local
`getApiTelemetrySnapshot()` call rather than through this Redis cross-instance path, so adding
them here would duplicate data that already flows correctly, not fix a real gap. Added a
source-text regression test (no runtime side effect exists to assert against) asserting the
file's source no longer contains `getApiTelemetrySnapshot` at all, so the dead call — or its
import — can't silently reappear without a deliberate decision to actually use the snapshot's
fields in the payload.
