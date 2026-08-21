import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE } from "@/lib/site";
import { LEARN_NAV, learnHref } from "@/lib/learn/nav";
import { GUIDE_SEO } from "@/lib/learn/guide-seo";

(globalThis as unknown as { React: typeof React }).React = React;

test("CourseJsonLd marks the academy as a free Course, provider-linked to the entity, with every chapter", async () => {
  const { CourseJsonLd } = await import("./JsonLd");
  const chapters = LEARN_NAV.map((item) => ({
    name: GUIDE_SEO[item.slug].metaTitle,
    description: GUIDE_SEO[item.slug].metaDescription,
    url: `${SITE.url}${learnHref(item.slug)}`,
  }));
  const html = renderToStaticMarkup(React.createElement(CourseJsonLd, { chapters }));
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*)<\/script>/)![1]);

  assert.equal(data["@type"], "Course");
  assert.equal(data.isAccessibleForFree, true);
  // provider references the ONE Organization entity node, not a duplicate
  assert.deepEqual(data.provider, { "@id": `${SITE.url}/#organization` });
  // free instance — a real offer of 0, not a fabricated price
  assert.equal(data.hasCourseInstance.offers.price, "0");
  // one LearningResource per real curriculum chapter — no drift, no truncation
  const parts = data.hasPart as { "@type": string; url: string }[];
  assert.equal(parts.length, LEARN_NAV.length);
  for (const p of parts) assert.equal(p["@type"], "LearningResource");
  // teaches must carry the same topic set the Organization declares knowsAbout
  assert.ok((data.teaches as string[]).some((t) => /gamma exposure|GEX/i.test(t)));
});
