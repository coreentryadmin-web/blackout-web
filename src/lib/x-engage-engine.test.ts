import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  isEngagementTarget,
  ENGAGEMENT_TARGET_SET,
  SEARCH_QUERIES,
  DISCOVERY_SEARCH_QUERIES,
} from "./x-engage-config";
import { pickEngagementQuote } from "./x-engage-replies";
import type { XTweetSearchHit } from "./x-api";

describe("isEngagementTarget", () => {
  it("matches curated FinTwit follow list", () => {
    assert.equal(isEngagementTarget("spotgamma"), true);
    assert.equal(isEngagementTarget("@Unusual_Whales"), true);
    assert.equal(isEngagementTarget("random_trader"), false);
    assert.ok(ENGAGEMENT_TARGET_SET.size >= 10);
  });
});

describe("pickEngagementQuote", () => {
  it("omits leading @ handle for quote commentary", () => {
    const q = pickEngagementQuote("trader_joe", "$SPX 0DTE gamma flip at 6318");
    assert.doesNotMatch(q, /^@\w+/);
    assert.match(q, /0DTE|flip|gamma/i);
  });
});

// REGRESSION (round 129): runEngagementSweep's section-3 "extra search likes" loop
// (`src/lib/x-engage-engine.ts`, the final `for (const t of candidates.slice(...))` block)
// used to `break` the ENTIRE remaining batch the first time `tryLike()` returned false —
// and `tryLike` returns false for ANY non-"ok" `likeTweet()` result, not just a rate limit
// or an exhausted budget. `likeTweet()` collapses every non-200/429 response (a deleted
// tweet, a protected/suspended author, a one-off 4xx/5xx) into the same generic "failed"
// value (see x-api.ts), which is indistinguishable from "out of budget" at the call site.
// So a single ordinary per-tweet failure for the FIRST candidate in the batch silently
// discarded every other candidate behind it — including any follow/retweet that would
// have fired for them — even though real like/follow/retweet budget remained and the
// account was never actually rate-limited. `stats.rateLimited` is already tracked and
// checked independently at the top of every pass, so this early-exit was pure waste.
//
// The two other engagement passes in the same file (discovery and curated-giants) never
// had this defect: they just skip a failed candidate and keep going. Only this third loop
// treated "a tweet failed to like" as "stop everything".
describe("runEngagementSweep — extra search-likes batch", () => {
  it("keeps processing later candidates after an earlier ordinary (non-rate-limit) like failure", async () => {
    const now = Date.now();
    const freshIso = new Date(now - 30 * 60 * 1000).toISOString(); // 30min old — well inside MAX_TWEET_AGE_HOURS
    const metrics = { impression_count: 600, like_count: 20, reply_count: 0, retweet_count: 0 };

    const candidateA: XTweetSearchHit = {
      id: "tweetA",
      text: "SPX gamma flip holding the line into the close",
      author_id: "userA",
      author_username: "trader_a",
      created_at: freshIso,
      public_metrics: metrics,
    };
    const candidateB: XTweetSearchHit = {
      id: "tweetB",
      text: "SPY call wall capping every rally attempt today",
      author_id: "userB",
      author_username: "trader_b",
      created_at: freshIso,
      public_metrics: metrics,
    };

    const likedIds: string[] = [];
    const followedIds: string[] = [];
    const retweetedIds: string[] = [];

    mock.module("./x-api", {
      namedExports: {
        lookupUserByUsername: async () => null,
        fetchUserTweets: async () => [],
        fetchFollowingUserIds: async () => [],
        searchRecentTweets: async (query: string) => {
          if ((DISCOVERY_SEARCH_QUERIES as readonly string[]).includes(query)) return [];
          if (query === SEARCH_QUERIES[0]) return [candidateA, candidateB];
          return [];
        },
        likeTweet: async (id: string) => {
          likedIds.push(id);
          // tweetA's like fails for an ORDINARY reason (deleted/blocked/5xx) — NOT a rate
          // limit. tweetB must still be reached and liked.
          return id === "tweetA" ? "failed" : "ok";
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
        X_BLOCK_RT_USERNAMES: new Set<string>(),
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

    assert.deepEqual(likedIds, ["tweetA", "tweetB"], "tweetB must be TRIED even though tweetA's like failed");
    assert.equal(stats.likes, 1, "only tweetB's like actually succeeded");
    assert.ok(followedIds.includes("userB"), "tweetB's author should still get followed — the earlier failure must not abort the batch");
    assert.ok(retweetedIds.includes("tweetB"), "tweetB should still get retweeted");
    assert.equal(stats.rateLimited, false, "an ordinary failure is not a rate limit");
  });
});
