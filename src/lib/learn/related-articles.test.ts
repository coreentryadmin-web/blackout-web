import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { relatedArticles } from "./related-articles.ts";

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
