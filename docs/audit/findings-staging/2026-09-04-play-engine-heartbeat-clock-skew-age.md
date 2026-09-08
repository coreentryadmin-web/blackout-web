# play-engine-heartbeat: negative `age_ms` on cross-replica clock skew — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/play-engine-heartbeat.ts` → `src/lib/admin-cron-health.ts` (admin cron dashboard) |
| **Severity** | P3 — admin-facing display bug, no member-facing or trading-logic impact |
| **Found by** | DISCOVERY 24/7 audit sweep, 2026-09-04 |

## Root cause

`play-engine-heartbeat.ts` tracks two engine heartbeats (SPX play-engine, Night Hawk 0DTE scan)
as `{ last_tick_at, tick_count, ... }` records. Each is written by `recordPlayEngineTick` /
`createEngineHeartbeat().recordTick` — which sets `last_tick_at = new Date().toISOString()` on
**whichever ECS replica ticked** and persists it via `setMeta` (Postgres) — and read back by
`loadPlayEngineHeartbeat` / `.load()`, explicitly documented as a "cross-replica" read that
hydrates from the DB rather than trusting only this process's in-memory state.

Both read paths computed the heartbeat's age as a plain subtraction:

```ts
const ageMs = lastTickAt ? now - new Date(lastTickAt).getTime() : null;   // buildHeartbeat()
const ageMs = tickAt ? now - new Date(tickAt).getTime() : null;           // snapshot() (factory)
```

`now` is `Date.now()` on the **reading** replica; `lastTickAt`/`tickAt` was written by
`Date.now()` on the **writing** replica (possibly a different one). Ordinary cross-replica clock
skew (a few hundred ms is normal on Fargate) can put the writer's clock fractionally *ahead* of
the reader's, making a tick that is in fact brand new compute to a **negative** `ageMs`.

That unclamped value was not just stored — it was formatted straight into an admin-visible
string. `admin-cron-health.ts` (`spx-evaluate` job override, lines ~336-354) does:

```ts
const hbAgeMin = playHb.age_ms != null ? Math.round(playHb.age_ms / 60_000) : null;
...
status_label: playHb.stale
  ? `Cron stale · engine tick ${hbAgeMin}m ago (stale)`
  : `Cron stale · engine tick ${hbAgeMin}m ago (heartbeat only)`,
```

So a skewed replica reading a heartbeat written moments ago by another replica could render
**"Cron stale · engine tick -1m ago (heartbeat only)"** on the admin cron dashboard — a
nonsensical negative age shown to an operator trying to diagnose the exact staleness class of
problem this override exists to surface. (The `stale`/`critical_stale` booleans were unaffected
in practice — a negative `ageMs` is always `< 5*60_000`, so it never flips those thresholds — but
the raw `age_ms` and the interpolated minute count were wrong on display.)

## Evidence

- `git stash` on `src/lib/play-engine-heartbeat.ts` alone (keeping the new test) reproduces the
  pre-fix state: `npx tsx --test src/lib/play-engine-heartbeat.test.ts` → 2 failures
  (`clampedHeartbeatAgeMs is not a function` — the export didn't exist pre-fix, i.e. the
  computation was inline and unclamped). Restoring the fix → `tests 5 / pass 5 / fail 0`.
- `npx tsc --noEmit` clean across the repo after the change.
- `src/lib/admin-cron-health.test.ts` (the direct consumer of `loadPlayEngineHeartbeat`'s output)
  still 7/7 green post-fix — the clamp is transparent to every existing caller.

## Blast radius

Two call sites shared the identical unclamped-subtraction shape in this one file:
1. `buildHeartbeat()` — backs `getPlayEngineHeartbeat()` / `loadPlayEngineHeartbeat()`, the SPX
   play-engine heartbeat consumed by `admin-cron-health.ts`'s `spx-evaluate` override (the
   status-label path shown above).
2. `createEngineHeartbeat()`'s `snapshot()` — the generic factory instance used for the Night
   Hawk 0DTE scan heartbeat (`zeroDteScanHeartbeat`, `getZeroDteScanHeartbeat` /
   `loadZeroDteScanHeartbeat`). Same DB-hydration/cross-replica shape, same latent bug; fixed in
   the same pass since it shares the one new helper.

No other file was touched — this is the one module in the repo using this exact
tick-write-on-one-replica / age-read-on-another shape that had not yet been clamped. Three sibling
call sites elsewhere in the codebase (`polygon-options-gex.ts`'s `clampedCacheAgeSec`,
`et-session-facts.ts`'s `ageSecondsFromIso`, `helix-thermal-compare.ts`'s local
`ageSecondsFromIso`) were already fixed in earlier passes today — this finding is the same defect
class, found by sweeping for the same "writer clock / reader clock, `now - writtenAt`, no clamp"
pattern the earlier fixes named as their signature.

## Fix rationale

Added one small exported pure helper, `clampedHeartbeatAgeMs(tickAtIso, nowMs)`, matching the
exact shape and doc-comment convention of `polygon-options-gex.ts`'s `clampedCacheAgeSec` (same
audit day, same bug class, kept consistent on purpose so a future sweep recognizes the pattern
immediately). Both `buildHeartbeat()` and `snapshot()` now call it instead of the raw
subtraction. `Math.max(0, ...)` on the millisecond delta (not the rounded/divided minute value)
so the clamp is exact regardless of what a caller later derives from `age_ms` — the alternative of
clamping only `hbAgeMin` in `admin-cron-health.ts` would have left the raw `age_ms` in the JSON
payload (and any future consumer of it) still negative.

Deliberately left unchanged: the `stale`/`critical_stale` boolean thresholds (never affected,
since a negative age is always below both), and every other freshness/age computation in the
repo that reads a timestamp sourced from something other than a *different replica's local
clock* (e.g. a `published`/`first_at` timestamp from an external feed or DB row a single process
wrote) — those are a different risk shape (upstream-provider clock, not ECS-replica-to-replica
skew) and are out of scope for this fix.
