import { test } from "node:test";
import assert from "node:assert/strict";
import { getLearnGuide } from "./guides";
import { guideFaqs } from "./types";
import { LEARN_NAV } from "./nav";

// Regression: /learn/[slug]'s guide branch rendered <ArticleJsonLd> but never
// <FAQPageJsonLd>, even though 6 of the 7 guides (all but glossary) carry a real
// `faq`-type section already visible on the page — free FAQ rich-snippet eligibility
// left on the table for content that already existed. guideFaqs() is what the page
// now calls to build that structured data from the same section the page renders.

test("guideFaqs extracts real FAQ items for every guide except glossary", () => {
  for (const { slug } of LEARN_NAV) {
    const guide = getLearnGuide(slug);
    const faqs = guideFaqs(guide.sections);
    if (slug === "glossary") {
      assert.equal(faqs.length, 0, "glossary has no faq section by design");
      continue;
    }
    assert.ok(faqs.length > 0, `${slug} should have at least one FAQ item`);
    for (const item of faqs) {
      assert.ok(item.question.length > 0, `${slug} FAQ item has an empty question`);
      assert.ok(item.answer.length > 0, `${slug} FAQ item has an empty answer`);
    }
  }
});

test("guideFaqs maps q/a to the FAQPageJsonLd question/answer shape", () => {
  const faqs = guideFaqs([
    { type: "faq", id: "faq", title: "FAQ", items: [{ q: "Q1?", a: "A1." }] },
  ]);
  assert.deepEqual(faqs, [{ question: "Q1?", answer: "A1." }]);
});

test("guideFaqs returns empty for sections with no faq type", () => {
  const faqs = guideFaqs([{ type: "prose", id: "intro", title: "Intro", paragraphs: ["hi"] }]);
  assert.deepEqual(faqs, []);
});
