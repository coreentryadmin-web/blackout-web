import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { whopMarketingUrl, xPostFooterLine } from "./x-whop-link";

describe("x-whop-link", () => {
  it("includes UTM params for attribution", () => {
    const url = whopMarketingUrl("desk_midday");
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=desk_midday/);
  });

  it("footer points to site pricing funnel", () => {
    const line = xPostFooterLine("desk_open");
    assert.match(line, /@BlackOutTrade/);
    assert.match(line, /blackouttrades\.com\/pricing/);
    assert.match(line, /utm_source=x/);
  });
});
