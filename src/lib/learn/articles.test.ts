import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LEARN_ARTICLES } from "./articles";
import { GUIDE_SEO } from "./guide-seo";

/**
 * Internal-link-graph health checks for learn articles.
 *
 * These tests enforce that every article maintains a minimum level of
 * cross-linking for SEO and discoverability. The thresholds are based on the
 * 2026-08-03 audit that brought all 42 articles above these minimums.
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const slugSet = new Set(LEARN_ARTICLES.map((a) => a.slug));

/** Parse all internal /learn/<slug> markdown links from a body string. */
function parseLearnLinks(body: string): string[] {
  const re = /\[(?:[^\]]*)\]\(\/learn\/([^)]+)\)/g;
  const targets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    targets.push(m[1]);
  }
  return targets;
}

/* ------------------------------------------------------------------ */
/*  Pre-compute link graph                                             */
/* ------------------------------------------------------------------ */

/** outgoing[slug] = set of article slugs this article links to */
const outgoing = new Map<string, Set<string>>();
/** incoming[slug] = set of article slugs that link TO this article */
const incoming = new Map<string, Set<string>>();

for (const a of LEARN_ARTICLES) {
  outgoing.set(a.slug, new Set<string>());
  incoming.set(a.slug, new Set<string>());
}

for (const a of LEARN_ARTICLES) {
  const targets = parseLearnLinks(a.body);
  for (const t of targets) {
    if (slugSet.has(t)) {
      outgoing.get(a.slug)!.add(t);
      incoming.get(t)!.add(a.slug);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("learn articles — internal link graph", () => {
  it("every article has at least 2 incoming links from other articles", () => {
    const violations: string[] = [];
    for (const a of LEARN_ARTICLES) {
      const count = incoming.get(a.slug)!.size;
      if (count < 2) {
        violations.push(`${a.slug}: ${count} incoming`);
      }
    }
    assert.equal(
      violations.length,
      0,
      `Articles with fewer than 2 incoming links:\n  ${violations.join("\n  ")}`
    );
  });

  it("every article has at least 3 outgoing links to other articles", () => {
    const violations: string[] = [];
    for (const a of LEARN_ARTICLES) {
      const count = outgoing.get(a.slug)!.size;
      if (count < 3) {
        violations.push(`${a.slug}: ${count} outgoing`);
      }
    }
    assert.equal(
      violations.length,
      0,
      `Articles with fewer than 3 outgoing links:\n  ${violations.join("\n  ")}`
    );
  });

  it("no orphan articles (0 incoming)", () => {
    const orphans = LEARN_ARTICLES.filter(
      (a) => incoming.get(a.slug)!.size === 0
    ).map((a) => a.slug);

    assert.equal(
      orphans.length,
      0,
      `Orphan articles (no incoming links):\n  ${orphans.join("\n  ")}`
    );
  });

  it("all internal /learn/ links point to valid article slugs", () => {
    // Hub/product slugs that are valid link targets but not in the article array
    const hubSlugs = new Set([
      "spx-slayer",
      "heat-maps",
      "helix-flows",
      "night-hawk",
      "largo-ai",
      "getting-started",
      "glossary",
    ]);

    const broken: string[] = [];
    for (const a of LEARN_ARTICLES) {
      const targets = parseLearnLinks(a.body);
      for (const t of targets) {
        if (!slugSet.has(t) && !hubSlugs.has(t)) {
          broken.push(`${a.slug} -> ${t}`);
        }
      }
    }
    assert.equal(
      broken.length,
      0,
      `Broken internal links:\n  ${broken.join("\n  ")}`
    );
  });

  it("total inter-article link count is at least 300", () => {
    let total = 0;
    for (const links of outgoing.values()) {
      total += links.size;
    }
    assert.ok(
      total >= 300,
      `Total inter-article links: ${total} (expected >= 300)`
    );
  });
});

describe("learn articles — meta description length", () => {
  // Google truncates SERP snippets around ~155-160 chars. 2026-08-08 audit found
  // best-0dte-trading-strategies at 173 chars (would cut off mid-sentence); this guards
  // against any future article regressing the same way.
  it("no article metaDescription exceeds 160 characters", () => {
    const violations = LEARN_ARTICLES.filter((a) => a.metaDescription.length > 160).map(
      (a) => `${a.slug}: ${a.metaDescription.length} chars`
    );
    assert.equal(
      violations.length,
      0,
      `Articles with metaDescription over 160 chars (will truncate in SERPs):\n  ${violations.join("\n  ")}`
    );
  });
});

describe("learn articles — meta description uniqueness", () => {
  // 2026-08-08 audit found /learn/options-trading-glossary (article) and /learn/glossary (guide)
  // shared a near-identical metaDescription — two distinct, both-indexable pages competing for
  // the same SERP snippet text. Guards against any future article/guide pair regressing the
  // same way, across BOTH sets (not just within articles), since that's exactly what happened.
  it("no two articles share an identical metaDescription", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const a of LEARN_ARTICLES) {
      const prior = seen.get(a.metaDescription);
      if (prior) dupes.push(`${a.slug} duplicates ${prior}`);
      else seen.set(a.metaDescription, a.slug);
    }
    assert.equal(dupes.length, 0, `Duplicate article metaDescriptions:\n  ${dupes.join("\n  ")}`);
  });

  it("no article's metaDescription is identical to any curriculum guide's", () => {
    const guideDescriptions = new Map(
      Object.entries(GUIDE_SEO).map(([slug, g]) => [g.metaDescription, slug])
    );
    const dupes: string[] = [];
    for (const a of LEARN_ARTICLES) {
      const guideSlug = guideDescriptions.get(a.metaDescription);
      if (guideSlug) dupes.push(`article ${a.slug} duplicates guide ${guideSlug}`);
    }
    assert.equal(dupes.length, 0, `Article/guide metaDescription duplicates:\n  ${dupes.join("\n  ")}`);
  });

  // A referenced-but-missing image is a broken <img> on a public page — Google flags it and the
  // reader sees a gap where a figure should be. The markdown ships in this repo but the asset lives
  // under public/, so nothing but this test couples the two. Guards every embedded diagram
  // (gamma-flip, call/put-wall, and any added later) at once.
  it("every local image referenced in an article body exists on disk", () => {
    const publicDir = join(import.meta.dirname, "..", "..", "..", "public");
    const missing: string[] = [];
    const re = /!\[[^\]]*\]\((\/[^)]+)\)/g;
    for (const a of LEARN_ARTICLES) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(a.body)) !== null) {
        const ref = m[1].split(/[?#]/)[0]; // strip any query/hash
        if (!existsSync(join(publicDir, ref))) missing.push(`${a.slug} → ${ref}`);
      }
    }
    assert.equal(missing.length, 0, `Article images missing from public/:\n  ${missing.join("\n  ")}`);
  });
});
