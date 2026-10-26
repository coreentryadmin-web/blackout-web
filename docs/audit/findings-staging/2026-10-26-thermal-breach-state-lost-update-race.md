> **kind:** `FINDING`

## Thermal Discord breach-state (`runThermalBreachAlerts`) had an unlocked read-modify-write — overlapping main-cron/5m-poller ticks could lose a crossing's dedup slot and re-fire a duplicate Discord alert — FIXED

| | |
|---|---|
| **Severity** | P2 (shared mutable state race — a lost update produces a visible, duplicate public Discord post, the same severity class as the X-marketing `markTweetReplied` fix, round 112) |
| **Surface** | `src/lib/thermal-discord-run.ts` — `runThermalBreachAlerts`, the single shared `thermal-discord:breach-state:v1` Redis key (`THERMAL_BREACH_STATE_KEY`, `src/lib/thermal-discord-breach-state.ts`), read by both `/api/cron/thermal-discord`'s main 15-minute schedule and its own `?breach_only=1` 5-minute breach poller |
| **Status** | FIXED |

### Root cause

`runThermalBreachAlerts` did an unlocked, multi-round-trip read-modify-write against a single
shared Redis row:

```ts
let state = await loadThermalBreachState();            // GET
for (const ev of detected) {
  const { alerts, state: nextState } = filterNewBreachAlerts([ev], state);
  if (!alerts.length) continue;
  const ok = await postDiscordWebhook(...);             // network round-trip, inside the window
  if (ok) state = nextState;
}
await saveThermalBreachState(state);                    // SET (overwrite)
```

`thermal-discord-run.ts`'s own top-of-file comment says exactly who calls this: "Cache-reader
only; **shared by main cron + 5m breach poller**." Both are independent EventBridge schedules
that fire the SAME `/api/cron/thermal-discord` route (`route.ts` line 125,
`breachResult = await runThermalBreachAlerts(webhook, columns)`), with no coordination between
them. The main cron's 15-minute cadence (`:00/:15/:30/:45`) and the poller's 5-minute cadence
(`:00/:05/:10/:15/...`) land on the SAME wall-clock minute every 15 minutes — a real, scheduled
overlap, not a hypothetical one — and nothing in the route or `runThermalBreachAlerts` prevents
both invocations from executing concurrently.

`filterNewBreachAlerts` merges a NEW crossing into the OLD `state` in application code (not an
atomic DB operation), so two overlapping calls that both read the same base `state` before
either saves produce two distinct failure shapes:

1. **Duplicate alert for the SAME crossing.** If both calls detect the identical crossing (e.g.
   both fetch columns close enough in time that both see SPY's flip now above its prior level),
   both independently compute `prev !== side` off the same stale `state` and both post —
   members see the same breach announced twice.
2. **Silently discarded state for a DIFFERENT crossing (the more insidious case).** If the main
   cron detects SPY's flip cross while the poller, off its own slightly-later fetch, detects
   QQQ's call-wall break, each call computes its OWN `nextState` from the SAME base and saves it
   — whichever save lands last **overwrites the other's update entirely**, because the save is a
   full-object overwrite, not a merge. The call whose write was clobbered leaves its crossing
   unmarked in the durably-saved state, so the NEXT tick re-detects it as "new" again and
   double-posts a crossing that should already have been marked seen.

This is the same unlocked-RMW shape rounds 111-114 already found and fixed in
`src/lib/x-marketing-meta.ts`/`x-rate-budget.ts` (per-process-type cron races) and
`src/lib/providers/gex-regime-events.ts` (concurrent per-ticker builds sharing one global
cursor row) — here the two concurrent callers are two DIFFERENT cron schedules sharing one
route and one Redis key, closest in shape to the `markTweetReplied` case (three cron routes
racing one row) rather than the single-call-site `recordPostHook` case.

### Evidence

New test `src/lib/thermal-discord-breach-lock-concurrency.test.ts` mocks
`loadThermalBreachState`/`saveThermalBreachState` with a real async gap on read (modeling an
actual Redis round-trip) and `tryAdvisoryLock`/`releaseAdvisoryLock` with real non-blocking,
process-wide-mutex semantics — the same harness shape as the X-marketing/GEX regression tests.

RED→GREEN confirmed via `git stash` on `src/lib/thermal-discord-run.ts` alone (test file
untouched):
- **Before the fix:** 2 of 3 cases fail. Two concurrent calls detecting DIFFERENT crossings
  (SPY flip + QQQ call-wall) land with only ONE of the two states persisted — the other is
  silently discarded exactly as described above. Five concurrent calls across five tickers land
  with only one ticker's state saved instead of five.
- **After the fix:** all three cases pass — every concurrent call's crossing lands in the final
  saved state, and the pre-existing "a failed webhook must not burn the alert slot" behavior is
  preserved unchanged under the lock.

### Blast radius

`runThermalBreachAlerts` has exactly one call site (`/api/cron/thermal-discord/route.ts`), so
the fix covers the entire blast radius with no further changes needed elsewhere. The sibling
`THERMAL_SPOT_META_KEY` read/write in the same function (`loadThermalSpotMeta`/
`persistSpotSnapshotAfterTick`) was deliberately left untouched: its write is a pure overwrite
of freshly-fetched spot values (never merged against the old value it read), so two concurrent
writers landing in either order both leave a materially-current snapshot — the same
idempotent-last-write-wins shape this repo's cron-DST audit already treats as correct (not a
race), unlike the breach-state merge this fix addresses. `runThermalScheduledPost`'s
`THERMAL_DISCORD_WALLS_KEY` read/write (same file) has the identical pure-overwrite shape and
is also not reachable from the breach-only poller path (`breachOnly` returns early in the
route, before `runThermalScheduledPost` is ever called), so it was not in scope either.

### Fix

Wrapped the load→per-event-diff→post→save critical section in `runThermalBreachAlerts` with
the same `tryAdvisoryLock`/`releaseAdvisoryLock` primitive used by the four prior fixes — a
Postgres session-scoped advisory lock (`pg_try_advisory_lock(hashtext(...))`), held for the
lifetime of one load+save cycle (including the webhook POSTs inside it, matching the existing
per-event "a failed webhook must not burn the alert slot" semantics exactly). Same bounded
retry (30 attempts × 60ms ≈ 1.8s max). If the lock still can't be acquired after the bound,
falls back to the old unlocked behavior with a `console.warn` rather than dropping a session's
breach alerts entirely — no worse than the pre-fix behavior, now visible in logs if it ever
fires.

### Fix rationale

Matched the established primitive/retry-bound/fallback shape from rounds 111-114 rather than
inventing a new one — proven in four prior instances of this exact bug class. Used a new,
dedicated lock key (`thermal-discord-breach-state-write`) distinct from all five prior fixes'
keys (`x-marketing-budget-write`, the `REPLIED_KEY`/`HOOKS_KEY`/`ENGAGE_ROTATION_KEY` locks, and
the GEX regime-event cursor lock) so this critical section doesn't serialize against unrelated
ones. Considered narrowing the lock to exclude the webhook POST calls (acquire → compute+save
the diff → release → post afterward), but that would reopen failure mode #1 above (two
overlapping calls could still both decide the same crossing is "new" and both post) while also
requiring a second lock acquisition to "unclaim" a slot on a failed post — more moving parts for
no correctness gain, since the realistic contention window (two cron schedules landing on the
same minute, a handful of breach events at most) is short enough that holding the lock through
the loop is the simpler, equally correct choice. Left `filterNewBreachAlerts`,
`loadThermalBreachState`/`saveThermalBreachState` themselves, and `loadThermalSpotMeta`/
`persistSpotSnapshotAfterTick` untouched.

### Tests

`src/lib/thermal-discord-breach-lock-concurrency.test.ts` (new, 3 cases) +
`src/lib/thermal-discord-breach-state.test.ts`, `src/lib/thermal-discord-eod.test.ts`,
`src/lib/thermal-discord-embed.test.ts`, `src/lib/thermal-discord-card.test.ts` (existing,
unaffected) +
`src/app/api/cron/thermal-discord/thermal-discord-dedup.test.ts`,
`thermal-discord-columns.test.ts`, `thermal-discord-rth.test.ts` (existing, unaffected) —
`npx tsx --experimental-test-module-mocks --test <all of the above>` all green. `npx tsc
--noEmit` clean. `npx eslint src/lib/thermal-discord-run.ts
src/lib/thermal-discord-breach-lock-concurrency.test.ts` clean.
