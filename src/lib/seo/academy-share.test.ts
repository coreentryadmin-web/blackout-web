import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { academyShareUrl, formatXPost } from "./academy-share.ts";

describe("academyShareUrl", () => {
  it("appends UTM params for social attribution", () => {
    const url = academyShareUrl("/learn/what-is-gex", "academy-gex", "x");
    assert.match(url, /^https:\/\/blackouttrades\.com\/learn\/what-is-gex\?/);
    assert.match(url, /utm_source=x/);
    assert.match(url, /utm_campaign=academy-gex/);
  });

  it("formatXPost includes link", () => {
    const post = formatXPost({
      path: "/learn/what-is-gex",
      campaign: "test",
      text: "Read this →",
    });
    assert.match(post, /utm_source=x/);
    assert.match(post, /Read this/);
  });
});
