# 2026-10-31 api-telemetry-redis.ts: orphaned `clearTelemetryRedisFlush`/`flushTimer`/`FLUSH_MS` left behind after the only scheduler that used them was removed

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 dead code / latent maintenance hazard |

## Root cause

`src/lib/api-telemetry-redis.ts` (ECS-instance telemetry → Redis, read back cross-instance by
the admin API dashboard and `market-health.ts`) used to be scheduled by a periodic
`scheduleTelemetryRedisFlush()`:

```ts
export function scheduleTelemetryRedisFlush(): void {
  if (flushTimer || !process.env.REDIS_URL?.trim()) return;
  flushTimer = setInterval(() => {
    void flushTelemetryToRedis();
  }, FLUSH_MS);
  flushTimer.unref?.();
  void flushTelemetryToRedis();
}
```

That function was removed as a confirmed-dead, zero-caller export in commit `07b304c4d`
("chore(cleanup): remove verified dead code post-redesign (−2,047 lines) (#889)", 2026-07-21) —
its own commit message lists it explicitly: *"ai-spend: isKnownModel · api-telemetry-redis:
scheduleTelemetryRedisFlush"*. Nothing in the repo ever replaced it: `flushTelemetryToRedis()`
and `readCrossInstanceTelemetry()` are called **on demand**, per-request, from
`src/lib/admin-api-dashboard.ts` and `src/lib/market-health.ts` — there is no scheduled/interval
flush path anywhere in the codebase (confirmed via `git log --all -S"setInterval(flushTelemetryToRedis"`
and `-S"scheduleTelemetryRedisFlush"`: both hits are the original add and the #889 removal, nothing
since).

That removal left three things behind that only ever existed to serve the removed scheduler:

- **`flushTimer`** (`let flushTimer: ReturnType<typeof setInterval> | null = null;`) — the
  interval handle `scheduleTelemetryRedisFlush()` used to set. With the sole setter gone, this
  variable can never become anything but its initial `null` for the lifetime of the process.
- **`clearTelemetryRedisFlush()`** — the counterpart meant to `clearInterval(flushTimer)`. Since
  `flushTimer` is permanently `null`, its `if (flushTimer)` branch can never run; the only other
  thing it did (`consecutiveMisses = 0; ticksToSkip = 0;`) just duplicates the back-off reset
  `flushTelemetryToRedis()` already performs itself on every successful flush. The function had
  become a guaranteed no-op with zero callers anywhere in the repo (verified by repo-wide grep —
  the only hit for `clearTelemetryRedisFlush` was its own declaration).
- **`FLUSH_MS`** — the interval period (`10_000`), used nowhere except inside the removed
  `setInterval(..., FLUSH_MS)` call. Post-removal it was referenced only in two explanatory
  comments as prose, never as a real value in any expression.

This is the same shape of drift this repo's standing dead-code policy exists to catch: a removal
that correctly killed the function everyone could see was unused, but left its private
supporting state behind because nothing forced a second look at what that function's own removal
orphaned.

## Evidence

- Repo-wide grep (`git grep -n "clearTelemetryRedisFlush"`) returns exactly one hit — the
  declaration itself — both before this fix and across the whole git history after commit
  `07b304c4d`.
- `git log --all -S"setInterval(flushTelemetryToRedis"` and `-S"scheduleTelemetryRedisFlush"`
  both terminate at the #889 removal commit; no later commit re-introduced a scheduler.
- `flushTelemetryToRedis`/`readCrossInstanceTelemetry` *do* have real, live callers —
  `admin-api-dashboard.ts` (admin API-health dashboard) and `market-health.ts` (market health
  summary) both call them directly, on every request, which is why only the scheduler-specific
  leftovers (`flushTimer`, `clearTelemetryRedisFlush`, `FLUSH_MS`) were dead, not the module as a
  whole.
- RED→GREEN proven via `git stash` on `src/lib/api-telemetry-redis.ts` alone (test file kept): the
  new regression test
  (`api-telemetry-redis.ts does not re-export the removed, callerless clearTelemetryRedisFlush`)
  **fails** against the pre-fix source (`clearTelemetryRedisFlush` is present) and **passes**
  once the export is removed. 2/2 new tests pass post-fix; `npx tsc --noEmit` and
  `npx eslint src/lib/api-telemetry-redis.ts src/lib/api-telemetry-redis.test.ts` are both clean.

## Blast radius

Checked every consumer of this module (`git grep -n "api-telemetry-redis"`):
`src/lib/admin-api-dashboard.ts` and `src/lib/market-health.ts` import only
`flushTelemetryToRedis`/`readCrossInstanceTelemetry`, never `clearTelemetryRedisFlush` or the
removed internals. No test file referenced `clearTelemetryRedisFlush`, `flushTimer`, or
`FLUSH_MS` before this change. The back-off state (`consecutiveMisses`/`ticksToSkip`/
`MAX_BACKOFF_TICKS`) is untouched and still does real work — it is read and written by
`flushTelemetryToRedis()` on every on-demand call, independent of whether a timer ever drove it.

## Fix rationale

Removed `flushTimer`, `clearTelemetryRedisFlush()`, and the now-fully-unused `FLUSH_MS` constant
together, since all three exist only in service of the scheduler that #889 already removed —
splitting them into separate PRs would just re-create the same "half-removed" state this finding
documents. Reworded the two comments that referenced `FLUSH_MS` by name to describe the back-off
in terms of calls/invocations instead of a fixed timer tick, since the module's real cadence is
now "whenever a caller asks," not a fixed interval. Left `consecutiveMisses`/`ticksToSkip`/
`MAX_BACKOFF_TICKS` and the rest of the module (Redis client singleton, cross-instance read
aggregation) completely unchanged — they are live, exercised code with real callers, not part of
this drift.

Did not attempt to re-introduce a scheduler instead of deleting the leftovers: `flushTelemetryToRedis()`
is already called on every admin-dashboard and market-health request, which is the module's real
production cadence today, and there is no evidence (no FINDINGS.md entry, no open issue) that a
fixed-interval flush was ever intentionally wanted back — #889's own write-up calls
`scheduleTelemetryRedisFlush` "confirmed dead," not "temporarily disabled."

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/api-telemetry-redis.test.ts` — 2/2
  green (new file).
- `npx tsx --experimental-test-module-mocks --test src/lib/api-telemetry.test.ts src/lib/api-telemetry-persist.test.ts src/lib/api-telemetry-redis.test.ts` — 9/9 green, no regressions in
  sibling telemetry suites.
- `npx tsc --noEmit` and `npx eslint src/lib/api-telemetry-redis.ts src/lib/api-telemetry-redis.test.ts` — both clean.
