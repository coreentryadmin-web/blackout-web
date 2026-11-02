> **kind:** FINDING

## Growth-engagement quote-tweets silently count as desk product posts in `checkPostGuard`'s daily cap + spacing check, because the only exclusion heuristic is "text starts with `@`" — FIXED

**Status:** FIXED (`fix/x-quote-postguard-miscount`)

### Root cause

`x-autopost` (the scheduled desk-content cron, `src/app/api/cron/x-autopost/route.ts`) gates
every post through `checkPostGuard()` (`src/lib/x-post-guard.ts`), which enforces a 7/day cap
and a 110-minute spacing floor over the account's *product* posts. It deliberately excludes
growth-engagement activity (mention replies, FinTwit quote/replies — `x-engage-engine.ts`) from
both checks, per its own comment: "Product posts include Whop footer — exclude @mention
outreach from spacing cap."

The exclusion was implemented as a single heuristic in both `countOwnProductPostsTodayEt` and
`minutesSinceLastProductPost`:

```ts
if (t.text.trim().startsWith("@")) return false; // "it's outreach, skip it"
```

This correctly catches a mention **reply** — `pickEngagementReply`/`pickMentionReply`
(`x-engage-replies.ts`) always prefix the body with `@handle `, every branch, unconditionally.

It does **not** catch a **quote**-tweet. `pickEngagementQuote` (same file) is built on top of
`pickEngagementReply` but then deliberately strips that exact prefix before returning:

```ts
export function pickEngagementQuote(username: string, tweetText: string): string {
  const withHandle = pickEngagementReply(username, tweetText);
  return withHandle.replace(/^@\w+\s+/, "").trim().slice(0, 280); // "no leading @ (quoted tweet provides context)"
}
```

So a posted quote-tweet's own text never starts with `"@"`. And `fetchUserTweets()`
(`x-api.ts`) cannot filter it server-side either: it passes `exclude=retweets,replies` to
`GET /users/{id}/tweets`, but a quote-tweet is its own standalone tweet to the X API — it is
*not* a "reply" in the API's sense — so it is NOT excluded by that param and comes back in the
exact same list `checkPostGuard` reads for real desk posts, indistinguishable from one by text
shape alone.

### Evidence

- Read `x-engage-replies.ts` line-by-line: `pickEngagementReply` always returns text starting
  with `` `@${handle} ...` ``; `pickEngagementQuote` always strips that prefix via
  `.replace(/^@\w+\s+/, "")` before returning — confirmed no code path leaves the `@` in place.
- Read `x-api.ts`'s `fetchUserTweets`: `exclude=retweets,replies` is the only server-side
  filter; X API docs classify a quote-tweet's `referenced_tweets` type as `"quoted"`, distinct
  from `"replied_to"`, so `exclude=replies` does not touch it.
- Read `x-engage-engine.ts`'s `tryQuote`: posts via `postQuoteTweet(text, tweet.id)` where
  `text = pickEngagementQuote(...)` — confirming the exact un-prefixed string that reaches the
  live timeline once `X_API_ACCESS_TIER=enterprise` is armed (quote-posting is gated behind
  `allowVisibleEngage = !silentOnly && enterprise`, per `x-marketing-env.ts`'s
  `xApiEnterpriseAccess()`).
- New regression tests (`x-post-guard.test.ts`, `isGrowthEngagementTweet` suite) — RED before
  the fix (the old inline `startsWith("@")` check fails the "quote-tweet via referenced_tweets"
  case: a plain-text quote comment with no leading `@` was indistinguishable from a real desk
  post), GREEN after introducing the `referenced_tweets`-aware predicate.

### Blast radius

Both of `checkPostGuard`'s checks are driven by the same broken heuristic and are both affected
identically:
- `countOwnProductPostsTodayEt` — a quote-tweet inflates `postsToday` toward the 7/day desk cap,
  so a day with real growth-engagement quote activity reaches "Daily cap reached" sooner than
  the actual number of scheduled desk posts would justify, silently dropping a real scheduled
  `x-autopost` slot.
- `minutesSinceLastProductPost` — if the most recent tweet on the timeline is a growth-engagement
  quote rather than a real desk post, its timestamp gets picked up as "the last product post",
  so `checkPostGuard` can report "Too soon (Nm since last post, need 110m)" against an unrelated
  engagement action, again dropping a real scheduled post.

Currently reachable only once `X_API_ACCESS_TIER=enterprise` is set (today's default is `ppu`,
which keeps `allowVisibleEngage` false and quote-posting disabled) — but the moment that tier is
armed for FinTwit quote/reply (the stated purpose of that env var, per `x-marketing-env.ts`'s own
comment), this miscount becomes live on every quote the growth engine posts, with no code change
or awareness needed to trigger it.

Not affected: `countOwnPostsTodayEt`/`minutesSinceLastOwnPost` (the legacy exports re-exported
from `x-api.ts`) — those count *every* original tweet with no `@`-prefix filtering at all, so
they were never relying on this heuristic; `checkPostGuard` does not call them.

### Fix rationale

Added `referenced_tweets` to `fetchUserTweets`'s requested `tweet.fields` and to the `XTweet`
type (`x-api.ts`), then introduced one pure, unit-tested predicate —
`isGrowthEngagementTweet(t)` in `x-post-guard.ts` — that both `countOwnProductPostsTodayEt` and
`minutesSinceLastProductPost` now call: true for a leading-`@` reply (unchanged behavior) OR a
tweet whose `referenced_tweets` marks it `"quoted"` (the new case). This fixes the exclusion at
its one shared root — the classification helper — rather than patching the two call sites
separately or trying to detect quotes by reconstructing `pickEngagementQuote`'s output shape,
which would be fragile against any future wording change to that function. Deliberately left
unchanged: the API's own `exclude=retweets,replies` param (still correct and still the cheaper,
server-side half of the filtering); the legacy `countOwnPostsTodayEt`/`minutesSinceLastOwnPost`
functions (different semantics, not used by `checkPostGuard`).
