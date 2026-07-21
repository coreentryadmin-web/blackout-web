import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  xMarketingPostsPaused,
  xMarketingSilentOnly,
} from "./x-marketing-env";

describe("x-marketing-env", () => {
  const prevPosts = process.env.X_MARKETING_POSTS_PAUSED;
  const prevSilent = process.env.X_GROWTH_SILENT_ONLY;

  beforeEach(() => {
    delete process.env.X_MARKETING_POSTS_PAUSED;
    delete process.env.X_GROWTH_SILENT_ONLY;
  });

  afterEach(() => {
    if (prevPosts === undefined) delete process.env.X_MARKETING_POSTS_PAUSED;
    else process.env.X_MARKETING_POSTS_PAUSED = prevPosts;
    if (prevSilent === undefined) delete process.env.X_GROWTH_SILENT_ONLY;
    else process.env.X_GROWTH_SILENT_ONLY = prevSilent;
  });

  it("defaults to active posting and visible growth", () => {
    assert.equal(xMarketingPostsPaused(), false);
    assert.equal(xMarketingSilentOnly(), false);
  });

  it("honors pause and silent env flags", () => {
    process.env.X_MARKETING_POSTS_PAUSED = "1";
    process.env.X_GROWTH_SILENT_ONLY = "true";
    assert.equal(xMarketingPostsPaused(), true);
    assert.equal(xMarketingSilentOnly(), true);
  });
});
