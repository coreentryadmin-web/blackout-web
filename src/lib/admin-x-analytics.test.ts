import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tweetEngagementScore } from "./admin-x-analytics";

describe("tweetEngagementScore", () => {
  it("weights replies and retweets above raw likes", () => {
    const likesOnly = tweetEngagementScore({
      likes: 1,
      replies: 0,
      retweets: 0,
      impressions: 0,
    });
    const replyHeavy = tweetEngagementScore({
      likes: 0,
      replies: 2,
      retweets: 0,
      impressions: 0,
    });
    assert.ok(replyHeavy > likesOnly);
  });
});
