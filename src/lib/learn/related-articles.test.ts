import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bodyLinksToSlug, relatedArticles } from "./related-articles.ts";

describe("relatedArticles", () => {
  it("returns linked articles for a pillar hub", () => {
    const related = relatedArticles("dealer-gamma-options-flow-guide", 6);
    assert.ok(related.length >= 3);
    assert.ok(related.every((a) => a.slug !== "dealer-gamma-options-flow-guide"));
  });

  it("returns empty for unknown slug", () => {
    assert.deepEqual(relatedArticles("not-a-real-slug"), []);
  });
});

describe("bodyLinksToSlug — reverse-backlink detection must match the outgoing-link parser", () => {
  // Regression: the old reverse check was `body.includes("(/learn/" + slug + ")")` (or the same
  // with a trailing "/"), a plain substring probe that never stripped an anchor fragment or a
  // trailing slash the way the outgoing-link regex does. A link written either way is correctly
  // parsed as OUTGOING from the article that wrote it, but was silently invisible to the target
  // article's own incoming-backlink pass — the two directions of the exact same markdown edge
  // disagreeing about whether it exists at all.
  it("detects a backlink that carries an in-page anchor fragment", () => {
    const body = "See the [gamma flip](/learn/gamma-flip-explained#regime) for the regime read.";
    assert.equal(bodyLinksToSlug(body, "gamma-flip-explained"), true);
  });

  it("detects a backlink written with a trailing slash", () => {
    const body = "See the [gamma flip](/learn/gamma-flip-explained/) for the regime read.";
    assert.equal(bodyLinksToSlug(body, "gamma-flip-explained"), true);
  });

  it("still detects the plain, no-suffix form (no regression on the common case)", () => {
    const body = "See the [gamma flip](/learn/gamma-flip-explained) for the regime read.";
    assert.equal(bodyLinksToSlug(body, "gamma-flip-explained"), true);
  });

  it("does not false-positive on a different link whose target merely starts with the slug", () => {
    const body = "See [gamma flip explained in depth](/learn/gamma-flip-explained-deep-dive) instead.";
    assert.equal(bodyLinksToSlug(body, "gamma-flip-explained"), false);
  });

  it("returns false when there is no link to the slug at all", () => {
    const body = "No links here, just prose about dealer gamma.";
    assert.equal(bodyLinksToSlug(body, "gamma-flip-explained"), false);
  });
});
