import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  isXMarketingCronSuppressed,
  X_MARKETING_CRON_KEYS,
} from "./x-marketing-paused.mjs";

describe("x-marketing-paused", () => {
  const prev = {};

  beforeEach(() => {
    for (const k of ["X_MARKETING_POSTS_PAUSED", "X_MENTION_REPLIES_PAUSED"]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ["X_MARKETING_POSTS_PAUSED", "X_MENTION_REPLIES_PAUSED"]) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("suppresses all X cron keys when X_MARKETING_POSTS_PAUSED=1", () => {
    process.env.X_MARKETING_POSTS_PAUSED = "1";
    for (const key of X_MARKETING_CRON_KEYS) {
      assert.equal(isXMarketingCronSuppressed(key), true);
    }
    assert.equal(isXMarketingCronSuppressed("flow-ingest"), false);
  });

  it("suppresses only x-replies when mention pause alone", () => {
    process.env.X_MENTION_REPLIES_PAUSED = "1";
    assert.equal(isXMarketingCronSuppressed("x-replies"), true);
    assert.equal(isXMarketingCronSuppressed("x-growth"), false);
  });
});
