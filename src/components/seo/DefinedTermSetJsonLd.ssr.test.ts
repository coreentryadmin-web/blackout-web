import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE } from "@/lib/site";
import { glossaryTermsFlat } from "@/lib/learn/guides/glossary";

// GEO guard: the glossary's DefinedTermSet must stay bound to the entity graph and must never
// drift from the visible glossary (a DefinedTerm describing a definition users can't see is a
// markup mismatch). It reads the SAME term source the page renders.

(globalThis as unknown as { React: typeof React }).React = React;

test("DefinedTermSet emits one DefinedTerm per visible glossary term, bound to the set + Org", async () => {
  const { DefinedTermSetJsonLd } = await import("./JsonLd");
  const terms = glossaryTermsFlat();
  const html = renderToStaticMarkup(
    React.createElement(DefinedTermSetJsonLd, {
      path: "/learn/glossary",
      name: "BlackOut Options & Dealer-Positioning Glossary",
      terms,
    }),
  );
  const m = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(m, "expected a JSON-LD script tag");
  const data = JSON.parse(m![1]);

  const setId = `${SITE.url}/learn/glossary#definedtermset`;
  assert.equal(data["@type"], "DefinedTermSet");
  assert.equal(data["@id"], setId);
  // bound to the Organization entity so the definitions inherit topical authority
  assert.deepEqual(data.about, { "@id": `${SITE.url}/#organization` });

  const emitted = data.hasDefinedTerm as { "@type": string; name: string; inDefinedTermSet: string }[];
  // one DefinedTerm per glossary term — no drift, no truncation
  assert.equal(emitted.length, terms.length);
  assert.ok(terms.length >= 8, "glossary should carry a real term set");
  for (const t of emitted) {
    assert.equal(t["@type"], "DefinedTerm");
    assert.equal(t.inDefinedTermSet, setId, "every term must reference its set");
  }
  // the core money term must be present
  assert.ok(emitted.some((t) => t.name === "GEX"), "GEX must be defined");
});
