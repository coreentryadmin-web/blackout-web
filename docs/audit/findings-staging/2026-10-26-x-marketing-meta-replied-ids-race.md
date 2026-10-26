> **kind:** `FINDING`

## X-marketing replied-tweet dedup set (`markTweetReplied`) had an unlocked read-modify-write — concurrent crons could silently lose an id and reply/quote-tweet the SAME tweet twice — FIXED

| | |
|---|---|
| **Severity** | P1 (shared mutable state race — a lost update here produces a visible, public DUPLICATE reply/quote-tweet from the brand account, not just an internal counter drift) |
| **Surface** | `src/lib/x-marketing-meta.ts` — `markTweetReplied`/`getRepliedTweetIds`, the shared dedup set behind `REPLIED_KEY` (`x_marketing_replied_ids`), written by `src/lib/x-engage-engine.ts` (quote/reply) and `src/lib/x-mention-replies.ts` (the `x-replies` cron) |
| **Status** | FIXED |

### Root cause

`markTweetReplied(tweetId)` did an unlocked, two-round-trip read-modify-write against the
single Postgres key-value row (`platform_meta` key `x_marketing_replied_ids`):

```ts
const set = await getRepliedTweetIds();   // SELECT
set.add(tweetId);
const arr = [...set].slice(-MAX_REPLIED);
await writeMeta(REPLIED_KEY, JSON.stringify(arr)); // UPSERT (overwrite)
```

This row is shared by **multiple separate cron routes**: `src/app/api/cron/x-growth/route.ts`
and `src/app/api/cron/x-engage/route.ts` are two independently-scheduled HTTP routes that both
call the exact same `runEngagementSweep` (`x-growth-engine.ts`'s `runGrowthSweep` is a thin
wrapper around it) — which calls `markTweetReplied` from `tryQuote`/`tryReply` whenever it
quote-tweets or replies to a FinTwit post — and `src/app/api/cron/x-replies/route.ts`
(`x-mention-replies.ts`'s `runMentionReplySweep`) calls `markTweetReplied` for every @mention
reply it posts, on the SAME row.

If two of these processes interleave — both `getRepliedTweetIds()` before either
`writeMeta()` lands — both compute their updated set from the same stale base, and the second
write clobbers the first: one process's tweet id is silently dropped from the dedup set (a
classic "lost update"), exactly the same shape round 111 found and fixed in
`x-rate-budget.ts`'s `recordBudgetUse`. The consequence here is more severe than that one:
losing a tweet id from `REPLIED_KEY` doesn't just undercount a soft rate cap — on the NEXT
cron run, `getRepliedTweetIds()`/`engagedIds.has(tweet.id)` no longer sees that tweet as
already-replied-to, so the engine can reply or quote-tweet the **same tweet a second time** —
a visible, public duplicate action posted from the `@BlackOutTrade` brand account.

Within a single `runEngagementSweep`/`runMentionReplySweep` invocation this was never a
problem — every `markTweetReplied` call there is `await`ed sequentially against its own
in-memory `engagedIds`/`replied` Set first, so a run never double-replies to the same tweet
*within itself*. The race is strictly cross-process: two cron fires overlapping in time (or a
manual run overlapping a scheduled one), racing the *same* `platform_meta` row, each marking a
DIFFERENT tweet id as replied at the same tick.

### Evidence

New test `src/lib/x-marketing-meta-concurrency.test.ts` (sibling of round 111's
`x-rate-budget-concurrency.test.ts`) mocks `@/lib/db`'s `getMeta`/`setMeta` with a real async
gap on read (modeling an actual Postgres round-trip) so two concurrent `markTweetReplied(...)`
calls — for *different* tweet ids, as `x-growth` and `x-engage` would produce — both read the
pre-update set before either writes, exactly the interleaving a real overlapping-cron race
produces. Mocks `tryAdvisoryLock`/`releaseAdvisoryLock` with real non-blocking,
session-scoped-mutex semantics.

RED→GREEN confirmed via `git stash` on `src/lib/x-marketing-meta.ts` alone (test file
untouched):
- **Before the fix:** all 3 cases fail — two concurrent marks for different tweet ids land as
  a set of size 1 instead of 2 (lost update); 8 concurrent marks for 8 different tweet ids land
  as 1 instead of 8; even the "same id marked twice concurrently" case loses the OTHER
  concurrently-marked id.
- **After the fix:** all three cases land every id, every time.

### Blast radius

Every writer of the shared replied-ids row: `x-growth`/`x-engage` (same underlying
`runEngagementSweep` → `tryQuote`/`tryReply`), and `x-replies`
(`x-mention-replies.ts`'s `runMentionReplySweep`). All go through the one shared
`markTweetReplied` function, so the fix covers every call site with no further changes
needed elsewhere. `getRepliedTweetIds` (the reader) needed no change — it already reads
whatever `markTweetReplied` last wrote; the bug was entirely in what got written. Did not
touch the file's other read-modify-write helpers with the same unlocked shape
(`recordPostHook`/`HOOKS_KEY`, `bumpEngageRotation`/`ENGAGE_ROTATION_KEY`,
`getCachedFollowingUserIds`+`invalidateFollowingCache`/`FOLLOWING_CACHE_KEY`) — each of those
races too, but a lost update there only weakens a soft content-similarity hint, repeats a
target-rotation offset, or causes one extra cache refresh API call; none of them can cause a
duplicate PUBLIC action the way losing a replied-tweet id does, so they're left as a
documented, lower-severity follow-up rather than widening this single-issue PR.

### Fix

Serialized the load+mutate+save critical section in `markTweetReplied` with the same
`tryAdvisoryLock`/`releaseAdvisoryLock` primitive this repo already uses for whole-cron-run
dedup (`flow-ingest.ts`, `welcome-sequence/route.ts`, `membership-reconcile/route.ts`,
`alert-outcome-sync/route.ts`, `helix-signal-outcomes/route.ts`) and that round 111 just added
to `recordBudgetUse` — a Postgres session-scoped advisory lock
(`pg_try_advisory_lock(hashtext(...))`), held on a dedicated pooled connection for exactly the
lifetime of one load+save. Wrapped in the same short bounded retry (30 attempts × 60ms ≈ 1.8s
max) as `recordBudgetUse`, since `tryAdvisoryLock` is non-blocking ("try", not a queue) and the
holder releases within one round-trip. If the lock still can't be acquired after the bound,
falls back to the old unlocked behavior with a `console.warn` rather than silently dropping
the tweet id forever — no worse than the pre-fix behavior, and now visible in logs if it ever
actually fires.

### Fix rationale

Matched round 111's fix exactly (same primitive, same retry bound, same fallback behavior)
rather than inventing a new pattern — this is a duplicate instance of the same root cause in
a sibling file, and the existing `tryAdvisoryLock`/`releaseAdvisoryLock` primitive is already
proven in this codebase (five other call sites, now six with `recordBudgetUse`, seven with
this fix). `tryAdvisoryLock` already returns `true` unconditionally when `!dbConfigured()`
(matching the existing single-process dev-mode/`memoryMeta` fallback behavior), so the lock is
a no-op exactly where there's nothing to race against. Left `getRepliedTweetIds`,
`readMeta`/`writeMeta`, and the in-memory `memoryMeta` dev/no-DB fallback untouched.

### Tests

`src/lib/x-marketing-meta-concurrency.test.ts` (new, 3 cases: different-tweet-id race,
8-way different-tweet-id race, same-id-raced-against-a-different-id). Existing
`src/lib/x-marketing-meta-freshness.test.ts`, `src/lib/x-engage-engine.test.ts`,
`src/lib/x-engage-replies.test.ts`, `src/lib/x-rate-budget.test.ts`, `src/lib/x-marketing-env.test.ts`
all still pass unaffected (`markTweetReplied`'s signature and call sites are unchanged — 17/17
green). `npx tsc --noEmit` clean. `npx eslint` clean on both changed files.
