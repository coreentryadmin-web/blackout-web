> **kind:** FINDING

## X-marketing discovery pass could like/follow/retweet the SAME new author twice in one sweep — FIXED

**Status:** FIXED (`fix/x-discovery-dup-author`)

### Root cause

`runEngagementSweep`'s discovery pass (`src/lib/x-engage-engine.ts`, `runDiscoveryPass`)
builds a `seenAuthors` set whose entire stated purpose is to spend the limited
like/follow/retweet budget across *distinct* new FinTwit voices discovered via
`DISCOVERY_SEARCH_QUERIES`, rather than repeatedly on one account.

The membership check and the membership write were split across two different passes over
the same batch:

```ts
const candidates = hits
  .filter((h) => {
    if (!isNewDiscoveryAuthor(h)) return false;
    if (seenAuthors.has(h.author_id!)) return false;   // CHECK
    ...
  })
  .sort(...);

for (const t of candidates) {
  ...
  seenAuthors.add(authorId);                           // WRITE — happens here, not above
  ...
}
```

`seenAuthors.has()` was evaluated while building `candidates` for **this** `hits` response;
`seenAuthors.add()` only ran afterward, while iterating the already-built `candidates` list.
So for a single X search call that returned more than one tweet from the *same* author — an
ordinary outcome for a broad topical query (e.g. one prolific/new trader posting several
times about gamma/0DTE in the lookback window) — every one of that author's tweets passed
the `seenAuthors.has()` check unchanged (the set was still empty for this author at filter
time), and the processing loop then liked, attempted-followed, and retweeted the SAME
author's two different tweets — spending two budget units, and visibly retweeting one new
voice twice onto `@BlackOutTrade`'s own public timeline in a single pass — instead of
spreading across two distinct new voices as the `seenAuthors` set exists to guarantee.

### Evidence

Added a regression test
(`src/lib/x-engage-engine-discovery-dedup.test.ts`) that mocks a discovery search response
carrying two different tweets from one new author (`newVoiceUser`) and asserts the pass
engages that author only once, keeping the higher-scoring tweet.

- Before the fix (`git stash` on `src/lib/x-engage-engine.ts` only): RED —
  `retweetedIds`/`likedIds` both contained `['tweetHigh', 'tweetLow']`, i.e. the same author's
  two tweets were both liked and both retweeted in one pass.
- After the fix: GREEN — only `tweetHigh` (the higher-scoring tweet) is liked/retweeted, the
  author is followed exactly once, and `stats.scanned` lists the author exactly once.

### Blast radius

Single call site: `runDiscoveryPass` is only reached from `runEngagementSweep`
(`src/lib/x-engage-engine.ts`), which is the shared engine behind both the `x-growth` and
`x-engage` cron routes (`runGrowthSweep`/direct call — see `src/lib/x-growth-engine.ts`'s own
doc comment). No other function reuses this `seenAuthors` pattern — the curated-giants pass
(section 2) and the "extra search likes" pass (section 3) each key off tweet id or per-tweet
liking, not an author-level dedup set, so they were not affected by this shape.

### Fix rationale

Filter for validity (author eligibility, age, repliability) first, rank by `scoreSearchHit`
descending, **then** dedupe by author as a second pass whose predicate checks *and* populates
`seenAuthors` together — so a repeat author within the same batch is dropped while keeping
their highest-scoring tweet, and the later processing loop's own `seenAuthors.add()` (kept,
now redundant but harmless, for the cross-query dedup that already worked correctly across
`q` iterations) no longer carries the entire dedup burden by itself. This preserves the
existing cross-query dedup behavior (unaffected, already correct) and fixes only the
within-one-response gap.

### Test plan

- `npx tsx --experimental-test-module-mocks --test src/lib/x-engage-engine.test.ts src/lib/x-engage-engine-discovery-dedup.test.ts` — 4/4 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` — run to confirm no unrelated regressions.
