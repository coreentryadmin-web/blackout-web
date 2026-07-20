import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { whopMarketingUrl, xPostFooterLine } from "./x-whop-link";

describe("x-whop-link", () => {
  it("includes UTM params for attribution", () => {
    const url = whopMarketingUrl("desk_midday");
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=desk_midday/);
  });

  it("footer fits tweet format", () => {
    assert.match(xPostFooterLine("desk_open"), /@BlackOutTrade/);
  });
});
