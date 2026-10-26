> **kind:** `FINDING`

## X-marketing recent-post-hooks dedup hint (`recordPostHook`) had an unlocked read-modify-write — overlapping posts could silently lose a hook and weaken near-duplicate content detection — FIXED

| | |
|---|---|
| **Severity** | P3 (shared mutable state race — a lost update here weakens a soft content-similarity hint, not a visible public duplicate action) |
| **Surface** | `src/lib/x-marketing-meta.ts` — `recordPostHook`/`getRecentPostHooks`, the shared recent-hooks list behind `HOOKS_KEY` (`x_marketing_recent_hooks`), written by `src/app/api/cron/x-autopost/route.ts` (its only call site) and read by `src/lib/x-content-dedup.ts`'s `getRecentPostHooks()` consumer to steer future generated posts away from near-duplicate content |
| **Status** | FIXED |

### Root cause

`recordPostHook(body)` did an unlocked, two-round-trip read-modify-write against the single
Postgres key-value row (`platform_meta` key `x_marketing_recent_hooks`):

```ts
const prev = await getRecentPostHooks();   // SELECT
prev.push(hook);
await writeMeta(HOOKS_KEY, JSON.stringify(prev.slice(-MAX_HOOKS))); // UPSERT (overwrite)
```

Round 112 found and fixed the identical read-modify-write shape in the same file's
`markTweetReplied` (`REPLIED_KEY`) and deferred this sibling as a lower-severity follow-up.
Unlike `markTweetReplied` (written by `x-growth`/`x-engage`/`x-replies` — three separately
scheduled cron routes sharing one row) or `recordBudgetUse` (round 111, written by every
budget-consuming action across those same crons), `recordPostHook` has exactly **one** call
site: `x-autopost/route.ts`'s post-success path (line ~227, right after `postTweet`/
`tweetWithImage` succeeds). So the realistic interleaving isn't a cross-cron-type race — it's
two overlapping invocations of that *same* route: e.g. two manual `?force=1&manual=1` triggers
run close together (`scripts/x-marketing-run.mjs` supports exactly this), or a manual run
racing a re-enabled scheduled fire. `checkPostGuard()` is explicitly skipped when `force=1` is
set (`if (!dryRun && !forcePost) { ... checkPostGuard ... }`), so nothing else in the route
prevents two such overlapping calls from both reaching `recordPostHook` with different content
at the same tick.

If two such calls interleave — both `getRecentPostHooks()` before either `writeMeta()` lands —
both compute their updated array from the same stale base, and the second write clobbers the
first: one process's posted hook is silently dropped from the recent-hooks list (a lost
update). The consequence is lower-severity than `REPLIED_KEY`'s: `x-content-dedup.ts` only uses
this list as a soft similarity hint for the *next* generated post, so a dropped hook weakens
(does not disable) the near-duplicate check rather than causing a visible duplicate public
action by itself.

Note: X marketing crons (`x-autopost`/`x-growth`/`x-replies`/`x-intel`) have their EventBridge
rules disabled in production as of 2026-08-28 (operator confirmed — see
`src/lib/cron-registry.test.ts`'s `INTENTIONALLY_UNREGISTERED` map and multiple prior
`FINDINGS.md` entries, e.g. 2026-07-29 `x-autopost cron STALE` — NO ACTION, working as
intended). That removes the *scheduled*-fire overlap risk specifically, but manual triggers via
`scripts/x-marketing-run.mjs`/`validate-x-marketing.mjs` (or EventBridge being re-enabled in the
future) are unaffected by that config, so the race is real whenever the route is invoked at all,
not merely theoretical dead code — same reasoning applied to this file's other read-modify-write
helpers in rounds 111/112.

### Evidence

New test `src/lib/x-marketing-meta-hooks-concurrency.test.ts` (sibling of round 111's
`x-rate-budget-concurrency.test.ts` and round 112's `x-marketing-meta-concurrency.test.ts`)
mocks `@/lib/db`'s `getMeta`/`setMeta` with a real async gap on read (modeling an actual
Postgres round-trip) so two concurrent `recordPostHook(...)` calls — for *different* bodies, as
two overlapping `x-autopost` invocations would produce — both read the pre-update array before
either writes. Mocks `tryAdvisoryLock`/`releaseAdvisoryLock` with real non-blocking,
session-scoped-mutex semantics.

RED→GREEN confirmed via `git stash` on `src/lib/x-marketing-meta.ts` alone (test file
untouched):
- **Before the fix:** 2 of 3 cases fail — two concurrent `recordPostHook` calls for different
  bodies land as a list of size 1 instead of 2 (lost update); 8 concurrent calls land as 1
  instead of 8.
- **After the fix:** all three cases land every hook, every time.

### Blast radius

`recordPostHook` has exactly one caller (`x-autopost/route.ts`), so the fix covers the entire
blast radius with no further changes needed elsewhere. `getRecentPostHooks` (the reader, used
by `x-content-dedup.ts`) needed no change — it already reads whatever `recordPostHook` last
wrote; the bug was entirely in what got written. Did not touch this file's two remaining
unlocked read-modify-write helpers with the same shape — `bumpEngageRotation`/
`ENGAGE_ROTATION_KEY` (lost increment just repeats a target-rotation offset, cosmetic) and
`getCachedFollowingUserIds`+`invalidateFollowingCache`/`FOLLOWING_CACHE_KEY` (a TOCTOU on a
cache, worst case one extra API call or briefly stale cache) — both lower stakes still, left
as a documented follow-up per the standing single-issue-per-PR discipline.

### Fix

Serialized the load+mutate+save critical section in `recordPostHook` with the same
`tryAdvisoryLock`/`releaseAdvisoryLock` primitive rounds 111/112 used for `recordBudgetUse` and
`markTweetReplied` — a Postgres session-scoped advisory lock
(`pg_try_advisory_lock(hashtext(...))`), held on a dedicated pooled connection for exactly the
lifetime of one load+save. Wrapped in the same short bounded retry (30 attempts × 60ms ≈ 1.8s
max), since `tryAdvisoryLock` is non-blocking ("try", not a queue) and the holder releases
within one round-trip. If the lock still can't be acquired after the bound, falls back to the
old unlocked behavior with a `console.warn` rather than silently dropping the hook forever — no
worse than the pre-fix behavior, and now visible in logs if it ever actually fires.

### Fix rationale

Matched rounds 111/112's fix exactly (same primitive, same retry bound, same fallback
behavior) rather than inventing a new pattern — this is a third instance of the same root cause
in the same file, and the existing primitive is already proven here (now eight call sites).
`tryAdvisoryLock` already returns `true` unconditionally when `!dbConfigured()` (matching the
existing single-process dev-mode/`memoryMeta` fallback behavior), so the lock is a no-op
exactly where there's nothing to race against. Used a dedicated lock key
(`x-marketing-recent-hooks-write`) distinct from `REPLIED_WRITE_LOCK`/`BUDGET_WRITE_LOCK` so the
three critical sections don't serialize against each other unnecessarily — they guard
independent rows. Left `getRecentPostHooks`, `readMeta`/`writeMeta`, and the in-memory
`memoryMeta` dev/no-DB fallback untouched.

### Tests

`src/lib/x-marketing-meta-hooks-concurrency.test.ts` (new, 3 cases) +
`src/lib/x-marketing-meta-freshness.test.ts` (existing, unaffected) —
`npx tsx --experimental-test-module-mocks --test src/lib/x-marketing-meta-hooks-concurrency.test.ts src/lib/x-marketing-meta-freshness.test.ts`
all green. `npx tsc --noEmit` clean. `npx eslint src/lib/x-marketing-meta.ts
src/lib/x-marketing-meta-hooks-concurrency.test.ts` clean.
