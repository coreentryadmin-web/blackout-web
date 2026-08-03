import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeskPath, learnArticleSlugFromPath } from "./ga4-events.ts";

describe("isDeskPath", () => {
  it("matches product desk routes", () => {
    assert.equal(isDeskPath("/dashboard"), true);
    assert.equal(isDeskPath("/flows"), true);
    assert.equal(isDeskPath("/pricing"), false);
  });
});

describe("learnArticleSlugFromPath", () => {
  it("extracts article slug", () => {
    assert.equal(learnArticleSlugFromPath("/learn/what-is-gex"), "what-is-gex");
    assert.equal(learnArticleSlugFromPath("/learn"), null);
    assert.equal(learnArticleSlugFromPath("/learn/glossary"), null);
  });
});
