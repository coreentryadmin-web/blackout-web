import assert from "node:assert/strict";
import { describe, it } from "node:test";
import robots from "./robots.ts";

describe("robots.ts", () => {
  it("points crawlers at the canonical sitemap", () => {
    const config = robots();
    assert.equal(config.sitemap, "https://blackouttrades.com/sitemap.xml");
  });

  it("allows public marketing paths while blocking app surfaces", () => {
    const config = robots();
    const wildcard = config.rules.find((rule) => rule.userAgent === "*");
    assert.ok(wildcard);
    assert.equal(wildcard?.allow, "/");
    const disallowed = wildcard?.disallow ?? [];
    assert.ok(disallowed.includes("/api/"));
    assert.ok(disallowed.includes("/admin/"));
    // /track-record is a public social-proof page (sanitized aggregate data
    // only) — must stay crawlable. See docs/marketing/SEO-GROWTH.md finding #2.
    assert.ok(!disallowed.includes("/track-record/"));
    assert.ok(!disallowed.includes("/learn/"));
    assert.ok(!disallowed.includes("/pricing"));
  });
});
