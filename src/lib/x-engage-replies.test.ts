import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickEngagementReply,
  pickEngagementQuote,
  pickMentionReply,
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

  it("pickEngagementQuote strips @ prefix", () => {
    const q = pickEngagementQuote("trader_joe", "SPX gamma flip at 6318");
    assert.doesNotMatch(q, /^@trader_joe/);
    assert.match(q, /flip/i);
  });
});

describe("pickMentionReply", () => {
  it("appends the warm closer cleanly when it fits", () => {
    const reply = pickMentionReply("trader_joe", "SPX gamma flip at 6318");
    assert.match(reply, /Always good to connect with traders in the space\.$/);
    assert.ok(reply.length <= 280);
  });

  it("never exceeds the 280-char tweet limit across the base-length range that triggers the closer", () => {
    // The prior implementation gated the warm-closer append on a flat `base.length <= 240`,
    // which assumed the closer text (" Always good to connect with traders in the space.",
    // 50 chars) fit in a 40-char budget. Any base in [231, 240] therefore produced a
    // 281-290 char reply — over X's 280 limit. Sweeping username lengths reproduces that
    // exact band without hardcoding it, so this stays correct if the reply copy changes.
    for (let n = 1; n <= 260; n += 1) {
      const username = "a".repeat(n);
      const reply = pickMentionReply(username, "0dte gamma flip question");
      assert.ok(
        reply.length <= 280,
        `pickMentionReply produced ${reply.length} chars for username length ${n}: ${reply}`
      );
    }
  });

  it("falls back to a bare slice when even the base reply is too long for the closer", () => {
    const reply = pickMentionReply("a".repeat(300), "0dte gamma flip question");
    assert.equal(reply.length, 279);
    assert.doesNotMatch(reply, /Always good to connect/);
  });
});
