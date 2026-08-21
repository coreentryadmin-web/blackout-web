import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEARN_ARTICLES } from "./articles.ts";
import { ARTICLE_FAQS, getArticleFaqs } from "./article-faqs.ts";

describe("article FAQ coverage", () => {
  it("every learn article has an FAQ set (FAQPage rich-result eligibility on every page)", () => {
    const missing = LEARN_ARTICLES.map((a) => a.slug).filter((slug) => getArticleFaqs(slug).length === 0);
    assert.deepEqual(missing, [], `articles missing FAQ schema: ${missing.join(", ")}`);
  });

  it("every FAQ set has at least 2 substantive Q&A pairs", () => {
    const thin: string[] = [];
    for (const [slug, items] of Object.entries(ARTICLE_FAQS)) {
      if (items.length < 2) thin.push(`${slug} (${items.length})`);
      for (const it of items) {
        // guards against a placeholder slipping in — real questions and answers, not stubs
        if (!/\?$/.test(it.question.trim())) thin.push(`${slug}: question missing "?"`);
        if (it.answer.trim().length < 40) thin.push(`${slug}: answer too short`);
      }
    }
    assert.deepEqual(thin, [], `thin or malformed FAQ sets: ${thin.join("; ")}`);
  });

  it("no FAQ references a slug that is not a real article", () => {
    const real = new Set(LEARN_ARTICLES.map((a) => a.slug));
    const orphans = Object.keys(ARTICLE_FAQS).filter((slug) => !real.has(slug));
    assert.deepEqual(orphans, [], `FAQ sets for non-existent articles: ${orphans.join(", ")}`);
  });
});
