> **kind:** FINDING

## X growth engine — `X_BLOCK_RT_USERNAMES` blocklist not enforced in section-3 "extra search likes" — FIXED

**Status:** FIXED (PR open, round 359 of the autonomous sweep)

### Root cause

`runEngagementSweep` (`src/lib/x-engage-engine.ts`) runs three sequential engagement passes
per cron tick: (1) discovery search, (2) curated FinTwit giants, (3) a plain keyword search
("Extra search likes on trending 0DTE posts"). `X_BLOCK_RT_USERNAMES` (`src/lib/x-api.ts`,
currently `{"IHate0dte", "ihate0dte"}` — a hostile/mocking account per its own name) is a
blocklist meant to keep the growth bot from ever engaging with that account, and two of the
three passes enforce it correctly:

- Pass 2 (curated giants): `if (X_BLOCK_RT_USERNAMES.has(handle)) continue;` — skips the whole
  target, no like/RT/reply.
- Pass 1 (discovery): `isNewDiscoveryAuthor()` checks `X_BLOCK_RT_USERNAMES.has(username)` as
  part of its candidate filter, gating likes, follows, and RTs for that pass.

Pass 3's candidate filter copied pass 1's shape (age check, author-username presence,
`isReplyableTweet`) but dropped the blocklist check entirely:

```ts
const candidates = hits
  .filter((h) => {
    if (tweetAgeHours(h.created_at) > MAX_TWEET_AGE_HOURS) return false;
    if (!h.author_username) return false;
    if (h.author_username.toLowerCase() === "blackouttrade") return false;
    return isReplyableTweet(h.text);
  })
  .sort((a, b) => scoreSearchHit(b) - scoreSearchHit(a));
```

`tryLike(t.id)` and `tryRetweet(t.id, imps)` below are then called for every surviving
candidate with no author check at all — `tryLike`/`tryRetweet` only check the tweet id and
impression count, never the author's username. (`tryFollow` for this same pass IS gated, via
`isNewDiscoveryAuthor(t)`, which is why only pass 3's like/RT path was exposed.)

### Evidence

Regression test `src/lib/x-engage-engine-block-list.test.ts` seeds one normal candidate and
one `@IHate0dte` candidate from the same `SEARCH_QUERIES[0]` hit list (both age-fresh,
impression-count well above the RT floor, both tweet bodies plausibly matching a 0DTE/gamma
search query given the account's own name/theme).

- **Pre-fix** (`git stash` on just `src/lib/x-engage-engine.ts`): `tryLike("tweetBlocked")`
  returns `"ok"` and gets counted — the blocked account's tweet is liked. Test fails:
  `AssertionError: blocked account's tweet must never be liked`.
- **Post-fix**: both the like and the retweet are skipped for `tweetBlocked`; the normal
  candidate is still liked normally. `stats.likes === 1`.

Confirmed via `git stash` / `git stash pop` on the one changed file, RED then GREEN, plus the
pre-existing sibling test `src/lib/x-engage-engine.test.ts` ("extra search-likes batch — keeps
processing later candidates after an earlier ordinary like failure") still passes unchanged.

### Blast radius

Only this one call site. Re-checked every other use of `X_BLOCK_RT_USERNAMES` in
`x-engage-engine.ts` (curated-giants loop, `isNewDiscoveryAuthor`) — both already correct.
No other file references this constant outside its own definition and its two existing tests.

### Fix rationale

Add the identical blocklist check (normalized lowercase, same as the discovery pass already
does) to pass 3's candidate filter, before the age/isReplyableTweet checks return. This keeps
the fix minimal and consistent with the two already-correct call sites, rather than introducing
a fourth way of expressing "is this author blocked." Deliberately left `tryLike`/`tryRetweet`
themselves unchanged (author-agnostic by design — every call site is responsible for filtering
its own candidate author set before calling them, which is the existing pattern in this file).

### Reachability

Real and live: `SEARCH_QUERIES` (x-engage-config.ts) target 0DTE/SPX/gamma/flow keywords, and
`@IHate0dte`'s own handle (chosen presumably because it posts critically about 0DTE trading)
makes it a plausible, not theoretical, hit for exactly those queries. This pass runs every
scheduled `x-growth` cron tick when `likeCap > 0` (the common case), with no dry-run gate.
