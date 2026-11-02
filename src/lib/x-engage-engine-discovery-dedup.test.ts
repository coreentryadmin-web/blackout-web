import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { DISCOVERY_SEARCH_QUERIES } from "./x-engage-config";
import type { XTweetSearchHit } from "./x-api";

// REGRESSION (round 358): runDiscoveryPass's `seenAuthors` dedup set used to be CHECKED
// inside the same `.filter()` that built a query's `candidates` list, but only POPULATED
// later, in the processing loop that consumes that same list — so for a single X search
// response carrying more than one tweet from the same new author (an ordinary occurrence
// for a broad market-topic query), every one of that author's tweets passed the filter
// unchanged and all of them got liked/followed/retweeted, spending multiple budget units —
// including a visible duplicate retweet of the same new voice — on one author instead of
// spreading across distinct ones, defeating the entire point of the `seenAuthors` set.
//
// Kept in its own file (not alongside x-engage-engine.test.ts's existing `it()`): node:test's
// `mock.module` + dynamic `import("./x-engage-engine")` pattern only behaves correctly when
// a given specifier is mocked-then-imported ONCE per process — a second `mock.module` +
// `import()` of the same specifiers inside the same file/process does not rebind the already
// -loaded module graph to the new mocks (see provider-health-reconcile.test.ts's `before()`
// -once pattern for the same reason), so this regression gets a fresh file/process instead.
describe("runEngagementSweep — discovery pass dedupes repeat authors within one query", () => {
  it("engages a same-author duplicate tweet only once, keeping the higher-scoring one", async () => {
    const now = Date.now();
    const freshIso = new Date(now - 30 * 60 * 1000).toISOString();

    // Same author, two different tweets, in the SAME search response. tweetHigh scores
    // higher (scoreSearchHit: impressions >= MIN_IMPRESSIONS_FOR_RT(500) and likes >= 10).
    const tweetHigh: XTweetSearchHit = {
      id: "tweetHigh",
      text: "Dealer gamma flip holding the tape together today",
      author_id: "newVoiceUser",
      author_username: "newvoice1",
      created_at: freshIso,
      public_metrics: { impression_count: 1000, like_count: 20, reply_count: 0, retweet_count: 0 },
    };
    const tweetLow: XTweetSearchHit = {
      id: "tweetLow",
      text: "Watching the call wall on this gamma setup",
      author_id: "newVoiceUser",
      author_username: "newvoice1",
      created_at: freshIso,
      public_metrics: { impression_count: 200, like_count: 1, reply_count: 0, retweet_count: 0 },
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
          if ((DISCOVERY_SEARCH_QUERIES as readonly string[]).includes(query)) {
            return [tweetHigh, tweetLow];
          }
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

    assert.deepEqual(likedIds, ["tweetHigh"], "only the higher-scoring tweet from the repeat author should be liked");
    assert.deepEqual(followedIds, ["newVoiceUser"], "the repeat author must be followed only once");
    assert.deepEqual(retweetedIds, ["tweetHigh"], "the repeat author must not be retweeted twice in one pass");
    assert.equal(
      stats.scanned.filter((s) => s === "discover:@newvoice1").length,
      1,
      "the repeat author should appear in scanned exactly once",
    );
  });
});
