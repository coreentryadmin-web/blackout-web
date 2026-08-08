import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `/learn/<unknown-slug>` must be a hard 404, not a 200 with an empty page.
 *
 * Measured on production 2026-08-08: `/learn/totally-fake-slug-xyz` returned **HTTP 200** with the
 * generic site title and no Article JSON-LD, while `/definitely-not-real-page-xyz` correctly
 * returned 404. `cf-cache-status: MISS` on the former, so this was the origin, not the edge.
 *
 * Cause: the `(marketing)` layout sets `revalidate = 3600`, putting this route on ISR. With the
 * default `dynamicParams: true`, an unknown slug took the on-demand render path and the
 * `notFound()` result was served with a 200 status. A soft-404 on an indexable path pattern is
 * worse than a plain 404 — search engines treat the URL as a thin page instead of dropping it, and
 * `/learn/<anything>` is an unbounded space.
 *
 * `dynamicParams = false` rejects any param outside `generateStaticParams` at the routing layer,
 * before the component runs. This test pins that, and pins the precondition that makes it safe:
 * every reachable slug must be statically enumerated, or real content would 404.
 */

const ROUTE = "src/app/(marketing)/learn/[slug]/page.tsx";

test("the learn slug route rejects unknown params at the routing layer", () => {
  const src = readFileSync(ROUTE, "utf8");
  assert.match(
    src,
    /export const dynamicParams = false/,
    `${ROUTE} must set \`dynamicParams = false\` — without it, ISR (revalidate=3600 on the ` +
      `(marketing) layout) serves unknown slugs as HTTP 200 soft-404s`
  );
  assert.match(src, /generateStaticParams/, "dynamicParams=false requires generateStaticParams");
});

test("every reachable learn slug is statically enumerated, so dynamicParams=false loses nothing", async () => {
  // The safety precondition, checked against the real data rather than assumed: if a guide existed
  // that generateStaticParams did not emit, dynamicParams=false would 404 real content.
  const [{ LEARN_NAV }, { LEARN_ARTICLES }, { GUIDE_SEO }] = await Promise.all([
    import("@/lib/learn/nav"),
    import("@/lib/learn/articles"),
    import("@/lib/learn/guide-seo"),
  ]);
  const emitted = new Set([
    ...LEARN_NAV.map((i: { slug: string }) => i.slug),
    ...LEARN_ARTICLES.map((a: { slug: string }) => a.slug),
  ]);
  const orphanGuides = Object.keys(GUIDE_SEO).filter((slug) => !emitted.has(slug));
  assert.deepEqual(
    orphanGuides,
    [],
    "these guides have SEO metadata but are not emitted by generateStaticParams, so they would 404"
  );
  assert.ok(emitted.size > 40, `expected the full learn catalogue, got ${emitted.size} slugs`);
});
