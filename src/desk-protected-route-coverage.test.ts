import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROTECTED_PREFIXES } from "./middleware-shared.ts";

/**
 * Every desk route under src/app/(site)/<slug>/ that gates its layout behind
 * requireDeskTool/requireTier must ALSO be registered in three independent, hand-maintained
 * lists — nothing derives them from the layout gate itself:
 *   1. `isProtectedRoute` in middleware-clerk.ts (Clerk's auth.protect() — a clean top-level
 *      HTTP 307 to /sign-in BEFORE any React rendering starts, and the gate to withNoEdgeCache's
 *      explicit no-store headers).
 *   2. `PROTECTED_PREFIXES` in middleware-shared.ts (a second, independent copy of the same
 *      prefix list).
 *   3. `DISALLOWED_ROOTS` in robots.ts (keeps crawlers off an auth-walled desk).
 *
 * /meridian shipped a real, live, tier-gated desk (layout.tsx calls requireDeskTool("premium",
 * "meridian")) missing from all three. Live-confirmed impact (2026-09-04): an anonymous request to
 * /meridian returned HTTP 200 with the root-layout chrome already streamed, then a 1s
 * `<meta http-equiv="refresh">` client-side redirect to /sign-in — instead of the clean top-level
 * 307 every sibling desk (e.g. /vector) returns instantly via middleware's auth.protect(). No
 * member data leaked (the layout's redirect() still fires before MeridianPageShell's data-bearing
 * children render), but the anonymous-visitor experience was measurably worse, /meridian was never
 * excluded from robots.txt, and it fell through to a no-op edge-cache header in production (see
 * withStagingNoEdgeCache — a no-op outside staging) instead of the explicit
 * `CDN-Cache-Control: no-store` every other protected desk gets. Root cause: two hand-maintained
 * route-prefix lists (middleware-clerk.ts, middleware-shared.ts) plus robots.ts's own list, none of
 * which are derived from — or checked against — the actual per-desk layout gates, so adding a new
 * gated desk silently omits it from all three unless someone remembers to update every list by hand.
 *
 * This test derives the "should be protected" set directly from the real layout.tsx files instead
 * of hand-listing desks, so the NEXT gated desk added under (site)/ fails here immediately if any
 * one of the three lists is not updated — the same class of bug cannot ship silently again.
 */

const SITE_DIR = join("src", "app", "(site)");
const MIDDLEWARE_CLERK = readFileSync("src/middleware-clerk.ts", "utf8");
const ROBOTS = readFileSync("src/app/robots.ts", "utf8");

/** Desk slugs under (site)/ whose layout.tsx gates access via requireDeskTool/requireTier. */
function tierGatedDeskSlugs(): string[] {
  const slugs: string[] = [];
  for (const entry of readdirSync(SITE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const layoutPath = join(SITE_DIR, entry.name, "layout.tsx");
    if (!existsSync(layoutPath)) continue;
    const src = readFileSync(layoutPath, "utf8");
    if (/requireDeskTool\(|requireTier\(/.test(src)) slugs.push(entry.name);
  }
  return slugs;
}

describe("desk protected-route coverage (middleware + robots.txt)", () => {
  const gatedSlugs = tierGatedDeskSlugs();

  it("found at least the known tier-gated desks (sanity check the scan itself works)", () => {
    // If this list ever shrinks to empty, the scan regex or the layout convention changed and
    // this test would otherwise pass vacuously — assert real desks are actually found.
    for (const known of ["vector", "nighthawk", "terminal", "heatmap", "flows", "meridian"]) {
      assert.ok(
        gatedSlugs.includes(known),
        `expected the tier-gate scan to find (site)/${known}/layout.tsx as gated`
      );
    }
  });

  it("every tier-gated desk is in middleware-clerk.ts's isProtectedRoute matcher", () => {
    const block = MIDDLEWARE_CLERK.slice(
      MIDDLEWARE_CLERK.indexOf("const isProtectedRoute = createRouteMatcher("),
      MIDDLEWARE_CLERK.indexOf("/** Dev-only board UI previews")
    );
    for (const slug of gatedSlugs) {
      assert.ok(
        block.includes(`"/${slug}(.*)"`),
        `/${slug} gates its layout behind requireDeskTool/requireTier but is missing from ` +
          `isProtectedRoute in middleware-clerk.ts — it will get a client-side redirect instead ` +
          `of a clean top-level 307, and will not receive withNoEdgeCache's no-store headers`
      );
    }
  });

  it("every tier-gated desk is in middleware-shared.ts's PROTECTED_PREFIXES", () => {
    for (const slug of gatedSlugs) {
      assert.ok(
        PROTECTED_PREFIXES.includes(`/${slug}`),
        `/${slug} gates its layout behind requireDeskTool/requireTier but is missing from ` +
          `PROTECTED_PREFIXES in middleware-shared.ts`
      );
    }
  });

  it("every tier-gated desk is disallowed in robots.ts", () => {
    const block = ROBOTS.slice(
      ROBOTS.indexOf("const DISALLOWED_ROOTS = ["),
      ROBOTS.indexOf("const DISALLOWED_PATHS")
    );
    for (const slug of gatedSlugs) {
      assert.ok(
        block.includes(`"/${slug}"`),
        `/${slug} gates its layout behind requireDeskTool/requireTier but is missing from ` +
          `DISALLOWED_ROOTS in robots.ts — crawlers are never told to skip it`
      );
    }
  });
});
