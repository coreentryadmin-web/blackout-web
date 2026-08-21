import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE } from "@/lib/site";

// Guards the entity graph that feeds Google's Knowledge Graph and the AI answer engines. The
// Organization and WebSite must resolve to ONE linked entity (shared @id references), carry the
// brand's topical authority (knowsAbout), and never emit a SearchAction the site cannot serve.

(globalThis as unknown as { React: typeof React }).React = React;

async function render(name: "OrganizationJsonLd" | "WebSiteJsonLd"): Promise<Record<string, unknown>> {
  const mod = await import("./JsonLd");
  const html = renderToStaticMarkup(React.createElement(mod[name]));
  const m = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(m, `expected a JSON-LD script tag from ${name}`);
  return JSON.parse(m[1]);
}

test("Organization and WebSite are one linked entity graph via @id", async () => {
  const org = await render("OrganizationJsonLd");
  const web = await render("WebSiteJsonLd");
  const orgId = `${SITE.url}/#organization`;

  assert.equal(org["@id"], orgId, "Organization must carry a stable @id");
  assert.equal(web["@id"], `${SITE.url}/#website`, "WebSite must carry a stable @id");

  // WebSite must REFERENCE the Organization by @id, not inline a duplicate Organization —
  // an inlined copy dilutes the entity instead of reinforcing it.
  assert.deepEqual(web.publisher, { "@id": orgId }, "publisher must reference the Org @id");
  assert.deepEqual(web.about, { "@id": orgId }, "about must reference the Org @id");
});

test("Organization carries topical authority + brand variants, and no fabricated fields", async () => {
  const org = await render("OrganizationJsonLd");

  const topics = org.knowsAbout as string[];
  assert.ok(Array.isArray(topics) && topics.length >= 5, "knowsAbout must list the brand's subjects");
  // The core money topic must be present — it is the site's whole differentiation and its top
  // real-query demand in Search Console.
  assert.ok(topics.some((t) => /gamma exposure|GEX/i.test(t)), "knowsAbout must include gamma exposure");
  assert.ok(topics.some((t) => /0DTE/i.test(t)), "knowsAbout must include 0DTE");

  const alt = org.alternateName as string[];
  assert.ok(alt.includes("BlackOut"), "alternateName must include the bare brand");

  // logo must be a resolvable ImageObject, not a bare string.
  assert.equal((org.logo as { "@type": string })["@type"], "ImageObject");

  // Never assert/emit fields we cannot verify — foundingDate and postal address are unknown, so
  // they must NOT appear (a fabricated entity fact is worse than an absent one).
  assert.equal(org.foundingDate, undefined);
  assert.equal(org.address, undefined);
});

test("WebSite emits no SearchAction — the site has no search endpoint to serve one", async () => {
  const web = await render("WebSiteJsonLd");
  assert.equal(web.potentialAction, undefined);
});
