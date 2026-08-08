import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEARN_ARTICLES } from "./articles";

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
