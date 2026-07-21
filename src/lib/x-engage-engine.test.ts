import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEngagementTarget,
  ENGAGEMENT_TARGET_SET,
} from "./x-engage-config";
import { pickEngagementQuote } from "./x-engage-replies";

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
