import { test } from "node:test";
import assert from "node:assert/strict";

import { isResearchTicker, researchTickerPath, researchTickers } from "./research-tickers";
import { publicSitemapEntries } from "@/lib/seo/sitemap-urls";

test("the research set is non-empty, unique, uppercase and stably ordered", () => {
  const t = researchTickers();
  assert.ok(t.length > 10, `expected a real set, got ${t.length}`);
  assert.equal(new Set(t).size, t.length, "no duplicates");
  for (const s of t) assert.equal(s, s.toUpperCase());
  assert.deepEqual(t, [...t].sort(), "alphabetical, so the sitemap diff is reviewable");
  // Two calls must agree — the sitemap and the route guard read this independently.
  assert.deepEqual(researchTickers(), t);
});

test("the liquid index and mega-cap names are covered", () => {
  const t = researchTickers();
  for (const expected of ["SPX", "SPY", "QQQ", "NVDA", "TSLA"]) {
    assert.ok(t.includes(expected), `${expected} should have a research page`);
  }
});

test("the route guard accepts exactly the published set", () => {
  for (const t of researchTickers()) {
    assert.ok(isResearchTicker(t), `${t} must pass`);
    assert.ok(isResearchTicker(t.toLowerCase()), "URLs are lowercase; the guard must normalize");
  }
  for (const bad of ["", "   ", "NOTATICKER", "../../etc/passwd", null, undefined]) {
    assert.equal(isResearchTicker(bad as string), false, `rejected: ${String(bad)}`);
  }
});

test("paths are lowercase and rooted at the research hub", () => {
  assert.equal(researchTickerPath("NVDA"), "/research/gamma-levels/nvda");
  assert.equal(researchTickerPath("  spx  "), "/research/gamma-levels/spx");
});

test("SITEMAP AND ROUTES CANNOT DRIFT — every research ticker has exactly one entry", () => {
  // The failure this catches is silent in both directions: a sitemap entry with no route is a
  // crawl error on every pass, and a route with no entry is a page nothing ever finds.
  const paths = publicSitemapEntries().map((e) => e.path);
  const research = paths.filter((p) => p.startsWith("/research/gamma-levels"));

  assert.ok(research.includes("/research/gamma-levels"), "the hub must be listed");
  for (const t of researchTickers()) {
    assert.ok(research.includes(researchTickerPath(t)), `${t} missing from the sitemap`);
  }
  assert.equal(
    research.length,
    researchTickers().length + 1,
    "the sitemap must carry the hub plus one entry per ticker and nothing else"
  );
  assert.equal(new Set(paths).size, paths.length, "no duplicate sitemap paths");
});

test("research pages are crawlable — no disallow rule shadows them", async () => {
  const robots = (await import("@/app/robots")).default();
  const disallowed = robots.rules;
  const rules = Array.isArray(disallowed) ? disallowed : [disallowed];
  for (const rule of rules) {
    const list = Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [];
    for (const d of list) {
      assert.ok(
        !"/research/gamma-levels/nvda".startsWith(d),
        `robots.txt rule "${d}" would block the research pages`
      );
    }
  }
});
