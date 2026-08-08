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
    assert.ok(disallowed.includes("/track-record/"));
    assert.ok(!disallowed.includes("/learn/"));
    assert.ok(!disallowed.includes("/pricing"));
  });

  it("disallows the bare route, not just its sub-paths (trailing-slash rules don't match the bare route)", () => {
    const config = robots();
    const wildcard = config.rules.find((rule) => rule.userAgent === "*");
    const disallowed = wildcard?.disallow ?? [];
    for (const root of [
      "/api",
      "/admin",
      "/dashboard",
      "/terminal",
      "/vector",
      "/nighthawk",
      "/flows",
      "/heatmap",
      "/grid",
      "/account",
      "/sign-in",
      "/sign-up",
      "/native-signin",
      "/embed",
      "/offline",
      "/track-record",
      "/_next",
    ]) {
      assert.ok(disallowed.includes(root), `expected disallow list to include bare route ${root}`);
      assert.ok(disallowed.includes(`${root}/`), `expected disallow list to include ${root}/`);
    }
  });

  it("applies the same bare-route + sub-path disallow list to AI crawler rules", () => {
    const config = robots();
    const gptbot = config.rules.find((rule) => rule.userAgent === "GPTBot");
    assert.ok(gptbot);
    const disallowed = gptbot?.disallow ?? [];
    assert.ok(disallowed.includes("/admin"));
    assert.ok(disallowed.includes("/admin/"));
  });
});
