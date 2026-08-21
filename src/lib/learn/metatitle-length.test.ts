import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARN_ARTICLES } from "./articles.ts";
import { GUIDE_SEO } from "./guide-seo.ts";

// SERP guard: Google truncates titles past ~60 characters with "…", hiding the end and cutting
// click-through on pages that already earn impressions. Keep every learn metaTitle <= 60 so the
// whole title (and its keyword) survives in the result. 60 is the conventional safe bound for the
// ~600px Google renders.
const MAX = 60;

describe("learn metaTitle length (SERP truncation guard)", () => {
  it("no article metaTitle exceeds 60 characters", () => {
    const over = LEARN_ARTICLES
      .filter((a) => a.metaTitle.length > MAX)
      .map((a) => `${a.slug} (${a.metaTitle.length}): ${a.metaTitle}`);
    assert.deepEqual(over, [], `titles that will truncate in SERPs:\n  ${over.join("\n  ")}`);
  });

  it("no guide metaTitle exceeds 60 characters", () => {
    const over = Object.entries(GUIDE_SEO)
      .filter(([, v]) => v.metaTitle.length > MAX)
      .map(([k, v]) => `${k} (${v.metaTitle.length}): ${v.metaTitle}`);
    assert.deepEqual(over, [], `guide titles that will truncate:\n  ${over.join("\n  ")}`);
  });
});
