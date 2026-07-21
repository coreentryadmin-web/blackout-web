import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tweetEngagementScore } from "./admin-x-analytics";

describe("tweetEngagementScore", () => {
  it("weights replies and retweets above raw likes", () => {
    const a = tweetEngagementScore({
      likes: 2,
      replies: 0,
      retweets: 0,
      impressions: 0,
    });
    const b = tweetEngagementScore({
      likes: 0,
      replies: 1,
      retweets: 0,
      impressions: 0,
    });
    assert.ok(b > a);
  });
});
