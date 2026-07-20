import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickEngagementReply,
  isReplyableTweet,
} from "./x-engage-replies";

describe("pickEngagementReply", () => {
  it("uses real username and contextual 0DTE copy", () => {
    const r = pickEngagementReply(
      "trader_joe",
      "$SPX 0DTE puts paid — vol crush all day",
    );
    assert.match(r, /@trader_joe/);
    assert.match(r, /0DTE|flip|gamma/i);
    assert.doesNotMatch(r, /@there/);
    assert.doesNotMatch(r, /whop/i);
  });

  it("isReplyableTweet filters promos", () => {
    assert.equal(isReplyableTweet("SPX gamma flip at 6318"), true);
    assert.equal(isReplyableTweet("discord.gg/join now"), false);
  });
});
