> **kind:** `FINDING`

## X growth engagement's "extra search likes" pass aborted the entire remaining batch on one ordinary like failure, wasting unused like/follow/retweet budget — FIXED

| | |
|---|---|
| **Severity** | P3 (product-enhancement lane — wasted engagement budget / reduced growth-sweep throughput, no member-facing or financial impact) |
| **Surface** | `src/lib/x-engage-engine.ts` — `runEngagementSweep`, step 3 ("Extra search likes on trending 0DTE posts"), run by both the `x-growth` and `x-engage` cron routes |
| **Status** | FIXED |

### Root cause

Step 3 of `runEngagementSweep` iterates a sorted batch of trending-search candidates and liked/followed/retweeted each one:

```ts
for (const t of candidates.slice(0, likeCap + (cronMode ? 1 : 2) + followCap)) {
  if (stats.rateLimited) break;
  stats.scanned.push(`search:@${t.author_username}`);
  if (!(await tryLike(t.id))) break;   // <-- the bug
  if (followCap > 0 && t.author_id && isNewDiscoveryAuthor(t)) {
    const followed = await tryFollow(t.author_id, t.author_username!, true);
    if (followed) followingIds.add(t.author_id);
  }
  const imps = t.public_metrics?.impression_count ?? 0;
  if (rtCap > 0) await tryRetweet(t.id, imps);
}
```

`tryLike()` returns `false` for three completely different reasons, and this loop could not tell
them apart:

1. `likeCap <= 0` — like budget for this run is exhausted (legitimate reason to stop).
2. `stats.rateLimited` was already `true` (legitimate reason to stop — and already checked
   independently at the top of the loop).
3. `likeTweet()` returned `"failed"` — the X API's `/2/users/{id}/likes` call returned some
   non-200, non-429 response. `likeTweet()` (`src/lib/x-api.ts`) collapses *every* such response
   (a deleted tweet, a protected/suspended author, a transient one-off 4xx/5xx) into the same
   generic `"failed"` string — this is **not** a budget or rate-limit condition at all, it is a
   fact about exactly one candidate tweet.

`if (!(await tryLike(t.id))) break;` treated all three cases identically: the very first
`"failed"` result for *any* candidate in the batch silently discarded every candidate behind it —
including the follow and retweet attempts those later candidates would otherwise have received —
even when real like/follow/retweet budget was still available and the account was never actually
rate-limited.

The other two engagement passes in the same file (`runDiscoveryPass`'s loop, and the curated
"giants" loop) never had this shape: a failed like for one tweet there just moves on to the next
tweet or account. Only this third, "extra search likes," loop turned one ordinary per-tweet
failure into an early exit for the whole batch.

### Evidence

New test in `src/lib/x-engage-engine.test.ts` mocks `./x-api`, `./x-marketing-meta`,
`./x-rate-budget`, and `./x-marketing-env` so `runEngagementSweep` can be driven end-to-end without
any network/DB access. It feeds step 3 exactly two candidates (`tweetA`, `tweetB`), makes
`likeTweet("tweetA")` resolve to `"failed"` (an ordinary non-rate-limit failure) and
`likeTweet("tweetB")` resolve to `"ok"`, with real like/follow/retweet budget left over.

RED→GREEN confirmed via `git stash` on `src/lib/x-engage-engine.ts` alone (test file untouched):

- **Before the fix:** `likeTweet` is only ever called with `"tweetA"` — the loop `break`s
  immediately after the first failure, `tweetB` is never even tried. `stats.likes === 0`,
  `tweetB`'s author is never followed, `tweetB` is never retweeted.
- **After the fix:** both tweets are tried (`likedIds === ["tweetA", "tweetB"]`), `stats.likes ===
  1` (only the genuinely-successful like counts), `tweetB`'s author is followed and `tweetB` is
  retweeted — the batch keeps going past the one ordinary failure.

### Blast radius

Only this one loop (`runEngagementSweep` step 3). The discovery pass and curated-giants loop
already skip-and-continue on a failed like, so they needed no change. `x-growth-engine.ts`'s
`runGrowthSweep` calls the same `runEngagementSweep`, so both the `x-growth` and `x-engage` cron
routes get the fix with no further changes.

### Fix rationale

Kept the existing `tryLike`/budget-decrement contract untouched (no new return type, no new
sentinel) — the loop now re-checks the two conditions that are *actually* legitimate reasons to
stop (`stats.rateLimited`, `likeCap <= 0`) before breaking, and otherwise `continue`s to the next
candidate on an ordinary failure rather than treating it as fatal. This mirrors exactly how the
sibling discovery/curated-giants passes already behave, so the three passes are now consistent
rather than one silently being far more fragile than the other two. Did not change `tryLike`
itself, or attempt to have `likeTweet()` distinguish failure reasons more finely (e.g. a dedicated
`"already_liked"` result) — that would be a larger, separate change to `x-api.ts`'s shared result
type, and the budget-vs-ordinary-failure distinction this loop actually needs is already fully
recoverable from state the loop already has (`stats.rateLimited`, `likeCap`).

### Tests

`src/lib/x-engage-engine.test.ts` (new `describe` block, 1 case). `npx tsc --noEmit` clean. `npx
eslint` clean on both changed files. Also re-ran the full `x-rate-budget`/`x-marketing-meta`
concurrency suites and the `x-engage` cron holiday-gate test — all pass unaffected (no shared
state/signature changed).
