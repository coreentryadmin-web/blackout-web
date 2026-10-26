import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  absolutizeLinks, canonicalUrl, coverImageUrl, syndicatedBody,
  eligibleArticles, pickToSyndicate, parseLimitArg, productShotFor, DEVTO_TAGS, HASHNODE_TAGS,
  devtoAlreadyPosted, hashnodePosted,
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

  it("cover image is a REAL desk screenshot when the topic maps to a product", () => {
    // a dealer-gamma article -> the Thermal heatmap screenshot, not a text card
    const u = coverImageUrl(art({ slug: "what-is-gex", targetKeyword: "what is gex", title: "What Is GEX?" }));
    assert.equal(u, `${SITE}/images/marketing/thermal.webp`);
    assert.equal(productShotFor(art({ slug: "how-to-read-options-flow", targetKeyword: "options flow" }))?.img, "helix");
    assert.equal(productShotFor(art({ slug: "best-0dte-trading-strategies", targetKeyword: "0dte strategies" }))?.img, "spx");
  });

  it("cover image falls back to the branded card for general-options topics with no product match", () => {
    const a = art({ slug: "wheel-strategy", targetKeyword: "wheel strategy", title: "The Wheel Strategy", description: "d" });
    assert.equal(productShotFor(a), null);
    assert.ok(coverImageUrl(a).startsWith(`${SITE}/api/og?`));
  });

  it("a product-matched article embeds a live-desk screenshot + CTA in the body", () => {
    const b = syndicatedBody(art({ slug: "gamma-flip-explained", targetKeyword: "gamma flip", title: "Gamma Flip Explained", path: "/learn/gamma-flip-explained" }));
    assert.ok(b.includes("### See it on the live desk"));
    assert.ok(b.includes(`${SITE}/images/marketing/thermal.webp`));
    assert.ok(b.includes(`${SITE}/heatmap`), "CTA links to the live desk");
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

  it("parseLimitArg honors an explicit --limit=0 (operator pause) instead of falling back to 1", () => {
    // `0` is falsy in JS — `Number(...) || 1` previously turned a deliberate `--limit=0` into `1`
    // and posted an article anyway, the opposite of what the flag was meant to do.
    assert.equal(parseLimitArg(["--limit=0"]), 0);
    // and that 0 actually limits pickToSyndicate's selection to nothing, not just that the
    // parsed number reads as 0 in isolation.
    const arts = [art({ slug: "a", path: "/learn/a", type: "article" })] as never;
    assert.deepEqual(pickToSyndicate(arts, new Set(), parseLimitArg(["--limit=0"])), []);
  });

  it("parseLimitArg falls back to the default for a missing or unparseable --limit", () => {
    assert.equal(parseLimitArg([]), 1);
    assert.equal(parseLimitArg(["--dry-run"]), 1);
    assert.equal(parseLimitArg(["--limit=abc"]), 1);
    assert.equal(parseLimitArg(["--limit="]), 1);
  });

  it("parseLimitArg still parses a normal positive --limit", () => {
    assert.equal(parseLimitArg(["--limit=5"]), 5);
  });
});

describe("already-posted fetch must fail CLOSED, not silently return a partial set", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // THE BUG THIS GUARDS AGAINST: a transient page-1 failure (rate limit, 5xx, auth hiccup) used to
  // `break` the pagination loop and return whatever had accumulated so far — for a page-1 failure,
  // an EMPTY set, i.e. "nothing has ever been posted". `pickToSyndicate` then trusted that empty set
  // and the daily cron re-posted an already-live article to the real Dev.to/Hashnode account: a
  // genuine duplicate, the exact thing the idempotency design is supposed to prevent. The fix is to
  // throw on a failed fetch so `main()`'s existing per-platform try/catch skips the run instead.

  it("devtoAlreadyPosted throws (not resolves to an empty set) when the Dev.to API 500s", async () => {
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    await assert.rejects(() => devtoAlreadyPosted("fake-key"), /Dev\.to .* 500/);
  });

  it("devtoAlreadyPosted keeps page-1 results AND throws when a later page fails mid-pagination", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        // A full page of 100 rows forces a page-2 request.
        const rows = Array.from({ length: 100 }, (_, i) => ({ canonical_url: `https://blackouttrades.com/learn/x${i}` }));
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;
    await assert.rejects(() => devtoAlreadyPosted("fake-key"), /Dev\.to .* page 2.* 429/);
  });

  it("hashnodePosted throws (not resolves to an empty set) on a malformed/errored GraphQL response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "not authorized" }] }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => hashnodePosted("fake-key", "pub-id"), /Hashnode[\s\S]*not authorized/);
  });

  it("hashnodePosted does NOT throw on a genuinely empty publication (real zero-posts case)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: { publication: { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
        { status: 200 }
      )) as typeof fetch;
    const posted = await hashnodePosted("fake-key", "pub-id");
    assert.equal(posted.size, 0);
  });
});
