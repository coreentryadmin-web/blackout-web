import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  xMarketingPostsPaused,
  xMentionRepliesPaused,
  xMarketingSilentOnly,
  xApiAccessTier,
  xApiEnterpriseAccess,
  xDeskPostIncludeUrl,
  xGrowthIntensive,
} from "./x-marketing-env";

describe("x-marketing-env", () => {
  const keys = [
    "X_MARKETING_POSTS_PAUSED",
    "X_MENTION_REPLIES_PAUSED",
    "X_GROWTH_SILENT_ONLY",
    "X_API_ACCESS_TIER",
    "X_DESK_POST_INCLUDE_URL",
    "X_GROWTH_INTENSIVE",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("defaults to pay-per-use without enterprise quote/reply", () => {
    assert.equal(xApiAccessTier(), "ppu");
    assert.equal(xApiEnterpriseAccess(), false);
    assert.equal(xDeskPostIncludeUrl(), false);
  });

  it("enterprise tier enables URL posts by default", () => {
    process.env.X_API_ACCESS_TIER = "enterprise";
    assert.equal(xApiEnterpriseAccess(), true);
    assert.equal(xDeskPostIncludeUrl(), true);
  });

  it("honors pause, silent, and explicit URL footer flags", () => {
    process.env.X_MARKETING_POSTS_PAUSED = "1";
    process.env.X_GROWTH_SILENT_ONLY = "true";
    process.env.X_DESK_POST_INCLUDE_URL = "1";
    assert.equal(xMarketingPostsPaused(), true);
    assert.equal(xMentionRepliesPaused(), true);
    assert.equal(xMarketingSilentOnly(), true);
    assert.equal(xDeskPostIncludeUrl(), true);
  });

  it("X_MENTION_REPLIES_PAUSED stops mention replies without full marketing pause", () => {
    process.env.X_MENTION_REPLIES_PAUSED = "1";
    assert.equal(xMentionRepliesPaused(), true);
    assert.equal(xMarketingPostsPaused(), false);
  });

  it("intensive growth defaults off unless X_GROWTH_INTENSIVE=1", () => {
    assert.equal(xGrowthIntensive(), false);
    process.env.X_GROWTH_INTENSIVE = "1";
    assert.equal(xGrowthIntensive(), true);
    process.env.X_GROWTH_INTENSIVE = "0";
    assert.equal(xGrowthIntensive(), false);
  });
});
