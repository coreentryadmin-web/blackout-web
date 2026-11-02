import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTweetContentValid, isGrowthEngagementTweet } from "./x-post-guard";

describe("isTweetContentValid", () => {
  const footer = "\n@BlackOutTrade blackouttrades.com/pricing?utm_source=x";

  it("rejects placeholder and spam patterns", () => {
    assert.equal(
      isTweetContentValid(
        "SPX, unknown gamma, flip flip" + footer,
      ),
      false,
    );
    assert.equal(isTweetContentValid("Short" + footer), false);
    assert.equal(isTweetContentValid("Hello #SPX gamma" + footer), false);
    assert.equal(isTweetContentValid("@there check this" + footer), false);
  });

  it("accepts real data-backed copy", () => {
    assert.equal(
      isTweetContentValid(
        "SPX $6312 in negative gamma below the $6318 flip. Dealers sell into weakness here — what's your read?" +
          footer,
      ),
      true,
    );
  });
});

describe("isGrowthEngagementTweet", () => {
  it("flags an @mention reply (leading @handle)", () => {
    assert.equal(
      isGrowthEngagementTweet({ text: "@trader Good question — flip is the line." }),
      true,
    );
  });

  it("flags a quote-tweet via referenced_tweets even with no leading @ — the bug this fixes", () => {
    // pickEngagementQuote() deliberately strips the leading @handle before posting, so the
    // only remaining signal that this is growth engagement (not a desk post) is the X API's
    // own referenced_tweets marker, not the body text.
    assert.equal(
      isGrowthEngagementTweet({
        text: "Solid take. Positioning (flip + walls) usually confirms these SPX setups — what's your level?",
        referenced_tweets: [{ type: "quoted", id: "123" }],
      }),
      true,
    );
  });

  it("does not flag a real scheduled desk product post", () => {
    assert.equal(
      isGrowthEngagementTweet({
        text: "SPX $6312 in negative gamma below the $6318 flip. What's your read?",
      }),
      false,
    );
  });

  it("does not flag a tweet that merely retweets/replies to something (non-quoted reference)", () => {
    assert.equal(
      isGrowthEngagementTweet({
        text: "SPX $6312 in negative gamma below the $6318 flip.",
        referenced_tweets: [{ type: "retweeted", id: "999" }],
      }),
      false,
    );
  });
});
