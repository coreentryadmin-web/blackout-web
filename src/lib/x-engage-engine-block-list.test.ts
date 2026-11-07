import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { SEARCH_QUERIES, DISCOVERY_SEARCH_QUERIES } from "./x-engage-config";
import type { XTweetSearchHit } from "./x-api";

// REGRESSION (round 359): runEngagementSweep's section-3 "extra search likes" loop
// (`src/lib/x-engage-engine.ts`, the final `for (const t of candidates.slice(...))` block,
// fed by a plain keyword SEARCH_QUERIES hit — not a discovery/curated-giants pass) never
// checked `X_BLOCK_RT_USERNAMES` before liking or retweeting a candidate.
//
// ROOT CAUSE: the OTHER two engagement passes in this same file both enforce the blocklist —
// the curated-giants loop does `if (X_BLOCK_RT_USERNAMES.has(handle)) continue;` before any
// engagement, and the discovery pass's candidate filter calls `isNewDiscoveryAuthor`, which
// itself checks `X_BLOCK_RT_USERNAMES`. Section 3's candidate filter copied the discovery
// pass's age/author/isReplyableTweet checks but silently dropped the blocklist check — so a
// blocked account's tweet (`@IHate0dte`/`@ihate0dte`, a hostile/mocking account per its own
// name — src/lib/x-api.ts) that happens to match one of the rotating SEARCH_QUERIES (which
// target 0DTE/SPX/gamma keywords this account is likely to post about, per its name) could
// still be liked AND retweeted by the growth bot — the exact outcome the blocklist exists to
// prevent, and the variable's own name ("BLOCK_RT") specifically promises never to retweet it.
//
// EVIDENCE: this test seeds one normal candidate and one @IHate0dte candidate from the same
// SEARCH_QUERIES[0] hit list; pre-fix, both get liked and the blocked one also gets retweeted.
//
// BLAST RADIUS: only this one call site (section 3) was missing the check — the curated-giants
// loop and the discovery pass were already correct, confirmed by reading every other use of
// X_BLOCK_RT_USERNAMES in x-engage-engine.ts.
describe("runEngagementSweep — extra search-likes batch respects X_BLOCK_RT_USERNAMES", () => {
  it("never likes or retweets a blocked account's tweet surfaced by a keyword search hit", async () => {
    const now = Date.now();
    const freshIso = new Date(now - 30 * 60 * 1000).toISOString();
    const metrics = { impression_count: 600, like_count: 20, reply_count: 0, retweet_count: 0 };

    const okCandidate: XTweetSearchHit = {
      id: "tweetOK",
      text: "SPX gamma flip holding the line into the close",
      author_id: "userOK",
      author_username: "trader_ok",
      created_at: freshIso,
      public_metrics: metrics,
    };
    const blockedCandidate: XTweetSearchHit = {
      id: "tweetBlocked",
      text: "0DTE gamma flip is fake, don't trade this garbage",
      author_id: "userBlocked",
      author_username: "IHate0dte",
      created_at: freshIso,
      public_metrics: metrics,
    };

    const likedIds: string[] = [];
    const retweetedIds: string[] = [];
    const followedIds: string[] = [];

    mock.module("./x-api", {
      namedExports: {
        lookupUserByUsername: async () => null,
        fetchUserTweets: async () => [],
        fetchFollowingUserIds: async () => [],
        searchRecentTweets: async (query: string) => {
          if ((DISCOVERY_SEARCH_QUERIES as readonly string[]).includes(query)) return [];
          if (query === SEARCH_QUERIES[0]) return [okCandidate, blockedCandidate];
          return [];
        },
        likeTweet: async (id: string) => {
          likedIds.push(id);
          return "ok";
        },
        retweet: async (id: string) => {
          retweetedIds.push(id);
          return "ok";
        },
        followUser: async (id: string) => {
          followedIds.push(id);
          return "ok";
        },
        postReply: async () => ({}),
        postQuoteTweet: async () => ({}),
        X_BLOCK_RT_USERNAMES: new Set(["IHate0dte", "ihate0dte"]),
      },
    });

    mock.module("./x-marketing-meta", {
      namedExports: {
        bumpEngageRotation: async () => 0,
        getRepliedTweetIds: async () => new Set<string>(),
        markTweetReplied: async () => {},
        getCachedFollowingUserIds: async () => new Set<string>(),
        invalidateFollowingCache: async () => {},
      },
    });

    mock.module("./x-rate-budget", {
      namedExports: {
        resolveRunBudget: async () => ({
          allowed: true,
          likes: 5,
          follows: 5,
          retweets: 5,
          replies: 5,
        }),
        recordBudgetUse: async () => {},
        pauseForRateLimit: async () => {},
        engagementJitterMs: () => 0,
      },
    });

    mock.module("./x-marketing-env", {
      namedExports: {
        xApiEnterpriseAccess: () => false,
        xGrowthIntensive: () => false,
        xMarketingSilentOnly: () => false,
      },
    });

    const { runEngagementSweep } = await import("./x-engage-engine");
    const stats = await runEngagementSweep({ cronMode: true, dryRun: false });

    assert.ok(!likedIds.includes("tweetBlocked"), "blocked account's tweet must never be liked");
    assert.ok(!retweetedIds.includes("tweetBlocked"), "blocked account's tweet must never be retweeted");
    assert.ok(!followedIds.includes("userBlocked"), "blocked account must never be followed");
    assert.ok(likedIds.includes("tweetOK"), "the normal, unblocked candidate must still be liked");
    assert.equal(stats.likes, 1, "only the unblocked candidate's like should count");
  });
});
