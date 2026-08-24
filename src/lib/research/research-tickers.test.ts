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

test("SITEMAP EXCLUDES RESEARCH UNTIL LICENSING — routes exist but are not submitted", () => {
  // Vendor redistribution for public derived gamma pages is still an open legal question.
  // Submitting 50+ programmatic URLs while that is unresolved is worse than not listing them.
  const paths = publicSitemapEntries().map((e) => e.path);
  const research = paths.filter((p) => p.startsWith("/research/gamma-levels"));
  assert.equal(research.length, 0, `research paths must not be in sitemap: ${research.join(", ")}`);
  assert.equal(new Set(paths).size, paths.length, "no duplicate sitemap paths");
});

test("research pages are not robots-blocked (noindex is layout-level, not disallow)", async () => {
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
