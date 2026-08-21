import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  absolutizeLinks, canonicalUrl, coverImageUrl, syndicatedBody,
  eligibleArticles, pickToSyndicate, DEVTO_TAGS, HASHNODE_TAGS,
} from "./syndicate-articles.mjs";

const SITE = "https://blackouttrades.com";
const art = (o: Record<string, unknown>) => ({
  slug: "x", path: "/learn/x", title: "T", description: "D", type: "article",
  body: "See [GEX](/learn/what-is-gex) and [pricing](/pricing).", ...o,
});

describe("syndication helpers", () => {
  it("absolutizes site-relative links but leaves absolute/protocol-relative alone", () => {
    const out = absolutizeLinks("[a](/learn/x) [b](//cdn/y) [c](https://z.com)");
    assert.ok(out.includes(`[a](${SITE}/learn/x)`));
    assert.ok(out.includes("[b](//cdn/y)"));       // protocol-relative untouched
    assert.ok(out.includes("[c](https://z.com)"));  // already absolute untouched
  });

  it("canonical always points back to our own page — the anti-cannibalization guarantee", () => {
    assert.equal(canonicalUrl(art({ path: "/learn/what-is-gex" })), `${SITE}/learn/what-is-gex`);
  });

  it("syndicated body carries the canonical in visible attribution AND absolutized links", () => {
    const b = syndicatedBody(art({ path: "/learn/what-is-gex" }));
    assert.ok(b.includes(`${SITE}/learn/what-is-gex`), "attribution links back to canonical");
    assert.ok(b.includes(`[GEX](${SITE}/learn/what-is-gex)`), "in-body link absolutized");
    assert.ok(!/\]\(\/learn/.test(b), "no site-relative links survive to the off-site copy");
  });

  it("cover image is the per-article branded card", () => {
    const u = coverImageUrl(art({ title: "What Is GEX?" }));
    assert.ok(u.startsWith(`${SITE}/api/og?`));
    assert.ok(u.includes("title=What+Is+GEX"));
  });

  it("eligibility keeps only pillars + articles, pillars first, drops glossary", () => {
    const list = eligibleArticles([
      art({ slug: "g", type: "glossary" }),
      art({ slug: "a", type: "article" }),
      art({ slug: "p", type: "pillar" }),
    ] as never);
    assert.deepEqual(list.map((a) => a.slug), ["p", "a"]);
  });

  it("pickToSyndicate skips anything whose canonical is already posted (idempotent)", () => {
    const arts = [
      art({ slug: "p", path: "/learn/p", type: "pillar" }),
      art({ slug: "a", path: "/learn/a", type: "article" }),
    ] as never;
    const already = new Set([`${SITE}/learn/p`]);
    const next = pickToSyndicate(arts, already, 5);
    assert.deepEqual(next.map((a) => a.slug), ["a"]);  // p already posted -> skipped
  });

  it("tags are valid by construction (Dev.to <=4 lowercase; Hashnode has slug+name)", () => {
    assert.ok(DEVTO_TAGS.length <= 4);
    for (const t of DEVTO_TAGS) assert.match(t, /^[a-z0-9]+$/);
    for (const t of HASHNODE_TAGS) { assert.ok(t.slug && t.name); }
  });
});
