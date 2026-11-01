> **kind:** FINDING

## play-engine-heartbeat.ts — cold-start hydration race silently drops a tick — FIXED

**Status:** FIXED (PR, see below)

### Root cause

`play-engine-heartbeat.ts`'s `ensureInitialized()` (and the identical shape in the generic
`createEngineHeartbeat()` factory's `ensureHydrated()`) hydrates `tickCount`/`lastTickAt` from
the cross-replica Postgres meta row exactly once per process, guarded by a boolean flag:

```ts
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true; // mark eagerly so concurrent callers don't double-read
  if (!dbConfigured()) return;
  try {
    const raw = await getMeta(HEARTBEAT_META_KEY);
    ...
    if (parsed.last_tick_at) applyHeartbeatPayload(parsed);
  } catch (err) { ... }
}
```

The flag was set to `true` **before** the `await getMeta(...)` resolved. The comment even said
so explicitly ("mark eagerly so concurrent callers don't double-read") — but a boolean flag set
synchronously, with no shared promise, does not make concurrent callers *wait*; it only stops
them from starting a *second* DB read. Any `ensureInitialized()` call that starts while an
earlier call's `getMeta()` is still in flight sees `initialized === true` on its very first
synchronous check and returns immediately — it proceeds past the `await` having skipped
hydration entirely, not merely having skipped re-reading it.

Concrete sequence (cold start, `tickCount` in-memory = 0, real persisted value = 50 from before
the restart):

1. Call A (`recordPlayEngineTick("cron")`) enters `ensureInitialized()`, sets `initialized =
   true`, and starts `await getMeta(...)` — a real DB round trip.
2. Call B (`recordPlayEngineTick("evaluate")`), firing essentially simultaneously, enters
   `ensureInitialized()`. `initialized` is already `true` (set synchronously by A in step 1,
   before A's own `await` ever yielded), so B's call resolves immediately — **without having
   waited for A's hydration to complete at all**.
3. B proceeds: `tickCount += 1` off its still-unhydrated value (0 → 1), and persists
   `{ tick_count: 1, ... }` via `setMeta`.
4. A's `getMeta()` now resolves with the real persisted row (`tick_count: 50`).
   `applyHeartbeatPayload()` overwrites `tickCount` with `50`, **silently discarding B's
   increment and B's persisted write**.
5. A continues: `tickCount += 1` → 51, and persists `{ tick_count: 51, ... }`.

Final state: `tickCount === 51`. The correct value, reflecting both real ticks on top of the
persisted 50, is 52. One genuine tick vanished from the running total with no error, no log line
pointing at it, and no test catching it (the existing `play-engine-heartbeat.test.ts` suite runs
with `DATABASE_URL` unset specifically so `dbConfigured()` is false and this hydration path never
executes at all).

### Evidence

New regression test `src/lib/play-engine-heartbeat-init-race.test.ts` mocks `./db` so
`dbConfigured()` is `true` and `getMeta()` resolves on the next macrotask (modeling a real DB
round trip, same technique as `thermal-discord-breach-lock-concurrency.test.ts`'s fake loader),
seeds a persisted `tick_count: 50`, then fires two `recordPlayEngineTick()` calls concurrently.

- **Pre-fix (`git stash` of the code change, test kept):** `51 !== 52` — confirms the lost tick,
  reproducing the exact mechanics above.
- **Post-fix:** `tick_count === 52` — both concurrent ticks are counted, and `getMeta` is called
  exactly once (single-flighted), not once per caller.

### Blast radius

The identical shape (boolean flag flipped eagerly before the `await` it's meant to guard) exists
twice in this one file:

1. `ensureInitialized()` — backs the SPX play-engine heartbeat (`recordPlayEngineTick`,
   `loadPlayEngineHeartbeat`, read by `admin-cron-health.ts`'s stale/critical-stale status label).
2. `createEngineHeartbeat()`'s `ensureHydrated()` — the generalized factory used (today) by the
   Night Hawk 0DTE scan heartbeat (`recordZeroDteScanTick`/`loadZeroDteScanHeartbeat`). Same race,
   same consequence: a scan-cadence tick can be silently dropped from the counter an admin uses to
   judge whether the scanner is alive.

Both are fixed with the identical single-flight pattern. No other module imports or reimplements
this hydrate-once-on-first-call shape (checked: `recordPlayEngineTick`/`recordZeroDteScanTick` are
the only two tick recorders in the codebase).

### Fix rationale

Replace the lone boolean flag with a single shared in-flight promise — the same pattern this
codebase already uses for an identical "hydrate/connect once, let concurrent callers await the
same completion" need: `flow-events.ts`'s `ensureRedisBridge()`/`bridgeInit` and
`shared-cache.ts`'s `getRedis()`/`redisInitPromise`. Every concurrent caller now gets the *same*
promise and genuinely waits for hydration (or the early `!dbConfigured()` exit) to finish before
touching `tickCount`/`lastTickAt`. The boolean flag is kept as a cheap fast-path for every call
*after* the first hydration completes (avoids re-awaiting a long-resolved promise's microtask
indefinitely), set only in a `finally` once the shared promise's work is actually done.

Deliberately NOT changed: the hydrate-once-per-process design itself, the meta-key scheme, the
staleness thresholds, or anything about how `admin-cron-health.ts` / the 0DTE board consume these
snapshots — this is purely a concurrency correctness fix to the hydration gate, scoped to the one
file that had the bug, with no behavior change on the non-concurrent (overwhelmingly common) path.

### Files

- `src/lib/play-engine-heartbeat.ts` (fix)
- `src/lib/play-engine-heartbeat-init-race.test.ts` (new regression test)
