> **kind:** FINDING

## Admin critical-alert bootstrap race drops the restart dedup guard, re-firing duplicate Discord alerts — FIXED

**Status:** FIXED (round 331)

### Root cause

`src/lib/admin-critical-alerts.ts`'s `bootstrapSeenFromDb()` guarded its once-per-process
`seenCritical` hydration (BUG-06 fix (b) — pre-populate from `admin_incidents` so a process
restart doesn't re-alert issues already notified in the last 24 hours) with a plain boolean
flipped to `true` **before** the `await dbQuery(...)` it was meant to gate ever resolved:

```ts
async function bootstrapSeenFromDb(): Promise<void> {
  if (seenBootstrapped) return;
  seenBootstrapped = true; // mark eagerly so concurrent callers don't double-query
  if (!dbConfigured()) return;
  try {
    const res = await dbQuery<{ fingerprint: string }>(...);
    for (const row of res.rows) addSeen(row.fingerprint);
  } catch (err) { ... }
}
```

The comment's own stated intent — "so concurrent callers don't double-query" — is only half of
what's needed. A synchronous boolean flag stops a second caller from starting a *second* read,
but it does not make that caller *wait* for the first read to finish. Any call to
`bootstrapSeenFromDb()` that reaches the `if (seenBootstrapped) return` check while an earlier
call's `dbQuery()` is still in flight sees `true` on its very first synchronous check and
returns immediately — skipping hydration entirely, not merely skipping a redundant query.

This is the exact same bug shape already fixed in `play-engine-heartbeat.ts`'s
`ensureInitialized()` (see PR #7321, open at time of writing): a plain boolean guard around an
async hydration step, with no shared in-flight promise.

### Evidence

`GET /api/admin/health` (`src/app/api/admin/health/route.ts`) calls `maybeAlertCriticalIssues`
on every load. Two near-simultaneous requests landing right after an ECS deploy/restart — two
admin tabs open, or one admin's auto-refresh racing a slow-starting DB pool — both pass the
bootstrap gate before either sees the persisted `admin_incidents` fingerprints.

Concrete sequence (cold start, `seenCritical` empty in-memory, a real critical issue was already
alerted <24h ago and is persisted in `admin_incidents`):

1. Call A (`maybeAlertCriticalIssues`) sets `seenBootstrapped = true` and starts `await
   dbQuery(...)` (a real DB round trip).
2. Call B, firing near-simultaneously, sees `seenBootstrapped` already `true` and proceeds
   immediately — without having waited for A's hydration.
3. B's `fresh` filter runs against the still-empty `seenCritical` Map, treats the
   already-alerted issue as brand new, and fires a duplicate Discord "SPX CRITICAL" alert.
4. A's `dbQuery()` later resolves and populates `seenCritical` — too late, the duplicate alert
   already went out.

New regression test `src/lib/admin-critical-alerts.test.ts` mocks `./db` so `dbConfigured()` is
`true` and `dbQuery()` resolves on the next macrotask (modeling a real DB round trip — same
technique `thermal-discord-breach-lock-concurrency.test.ts`'s fake loader uses), seeds a
persisted fingerprint for the test issue, then fires two `maybeAlertCriticalIssues()` calls
concurrently.

- **Pre-fix** (`git stash` of the code change, test kept): `1 !== 0` — one of the two concurrent
  calls re-alerts an issue that was already persisted as seen, reproducing the bug exactly.
- **Post-fix**: both calls correctly report 0 fresh issues, zero Discord alerts fire, and the
  bootstrap query runs exactly once (single-flighted, not once per caller).

A second test confirms a genuinely new critical issue still alerts exactly once across
concurrent callers (no regression on the non-racy/common path). Full existing suite green,
`tsc --noEmit` clean.

### Blast radius

Single call site (`GET /api/admin/health`), single function (`maybeAlertCriticalIssues`), single
hydration gate (`bootstrapSeenFromDb`). No other function in this file reimplements the
hydrate-once-on-first-call shape.

### Fix rationale

Replace the lone boolean flag with a single shared in-flight promise (`bootstrapPromise`) — the
same pattern this codebase already uses for an identical "hydrate once, let concurrent callers
await the same completion" need (`shared-cache.ts`'s `getRedis()`/`redisInitPromise`,
`flow-events.ts`'s `ensureRedisBridge()`/`bridgeInit`, and the fix just applied to
`play-engine-heartbeat.ts`'s `ensureInitialized()`). Every concurrent caller now awaits the SAME
promise before touching `seenCritical`. The boolean flag stays as a cheap fast path for calls
*after* hydration has genuinely finished, set in a `finally` so a thrown/rejected bootstrap still
unblocks future calls rather than wedging every caller behind a dead promise forever.

Deliberately NOT changed: the hydrate-once-per-process design, the `admin_incidents` query, the
`MAX_SEEN` eviction cap, or anything about how `GET /api/admin/health` consumes the result —
purely a concurrency correctness fix to the bootstrap gate.
