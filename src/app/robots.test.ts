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
    assert.ok(([] as string[]).concat(wildcard?.allow ?? []).includes("/"));
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

  it("keeps the OG image renderer crawlable despite the blanket /api disallow", () => {
    // Every public page points og:image, twitter:image AND Article JSON-LD's `image` at
    // /api/og. A blanket Disallow: /api made that image unfetchable for Google/Bing (and the
    // AI crawlers), which suppresses Article rich results — the bug this test locks down.
    const config = robots();
    for (const rule of config.rules) {
      const allowed = ([] as string[]).concat(rule.allow ?? []);
      assert.ok(
        allowed.includes("/api/og"),
        `expected ${String(rule.userAgent)} to allow /api/og`,
      );
      // The Allow must be strictly longer than every /api Disallow it has to override,
      // because both Google and Bing resolve the conflict by longest-match.
      const disallowed = ([] as string[]).concat(rule.disallow ?? []);
      for (const d of disallowed.filter((x) => "/api/og".startsWith(x))) {
        assert.ok(
          "/api/og".length > d.length,
          `Allow /api/og must outrank Disallow ${d} by length`,
        );
      }
    }
  });

  it("does not widen access to any other API route", () => {
    const config = robots();
    for (const rule of config.rules) {
      const allowed = ([] as string[]).concat(rule.allow ?? []);
      const apiAllows = allowed.filter((p) => p.startsWith("/api"));
      assert.deepEqual(apiAllows, ["/api/og"]);
      // The blanket block itself must survive — /api and /api/ stay disallowed.
      const disallowed = ([] as string[]).concat(rule.disallow ?? []);
      assert.ok(disallowed.includes("/api"));
      assert.ok(disallowed.includes("/api/"));
    }
  });
});
