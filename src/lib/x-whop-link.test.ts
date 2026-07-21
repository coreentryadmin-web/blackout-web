import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { whopMarketingUrl, xPostFooterLine } from "./x-whop-link";

describe("x-whop-link", () => {
  const prevUrl = process.env.X_DESK_POST_INCLUDE_URL;
  const prevTier = process.env.X_API_ACCESS_TIER;

  beforeEach(() => {
    delete process.env.X_DESK_POST_INCLUDE_URL;
    delete process.env.X_API_ACCESS_TIER;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.X_DESK_POST_INCLUDE_URL;
    else process.env.X_DESK_POST_INCLUDE_URL = prevUrl;
    if (prevTier === undefined) delete process.env.X_API_ACCESS_TIER;
    else process.env.X_API_ACCESS_TIER = prevTier;
  });

  it("includes UTM params for attribution", () => {
    const url = whopMarketingUrl("desk_midday");
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=desk_midday/);
  });

  it("footer omits URL by default (PPU $0.015/post)", () => {
    const line = xPostFooterLine("desk_open");
    assert.match(line, /@BlackOutTrade/);
    assert.doesNotMatch(line, /blackouttrades\.com/);
    assert.match(line, /link in bio/i);
  });

  it("footer includes pricing URL when opted in", () => {
    const line = xPostFooterLine("desk_open", { includeUrl: true });
    assert.match(line, /blackouttrades\.com\/pricing/);
    assert.match(line, /utm_source=x/);
  });
});
