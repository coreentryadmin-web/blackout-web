/**
 * Regression guard for the exact bug class documented in
 * docs/audit/findings-staging/2026-11-01-admin-health-routes-missing-cdn-nostore-headers.md
 * and already fixed once (for a different four routes) by
 * src/app/api/admin/no-store-headers-admin-health.guard.test.ts:
 *
 *   A route imports NO_STORE_HEADERS from "@/lib/no-store-headers" but never
 *   actually applies it to a returned response — it sets a bare
 *   `{ "Cache-Control": "no-store" }` literal instead, which is missing the
 *   CDN-scoped `CDN-Cache-Control` / `Cloudflare-CDN-Cache-Control` headers
 *   that are the ones that actually stop a Cloudflare cache rule with
 *   `override_origin` from edge-caching the response (see the doc comment on
 *   NO_STORE_HEADERS in src/lib/no-store-headers.ts). The repo's general
 *   src/lib/no-store-headers.guard.test.ts only checks that a route IMPORTS
 *   the constant somewhere — it cannot tell a real usage from a dead import.
 *
 * The 2026-11-01 finding doc named nine routes with this exact defect and
 * fixed only four of them (the admin/*-health siblings), explicitly leaving
 * `admin/nighthawk/analytics`, `admin/nighthawk/publish-preview`,
 * `admin/nighthawk/regrade-stuck-outcomes`, `admin/playbook/fsm-today`,
 * `admin/playbook/promotion-report`, `admin/zerodte/health` and
 * `admin/zerodte/regrade-index-roots` for "a dedicated pass by the owning
 * lane" because they sat inside this repo's then-current exclusion list.
 * Round 410 is that dedicated pass for these seven (the remaining two named
 * routes, `market/spx/pulse/stream` and `market/zerodte/marks/stream`, are
 * handled separately / left for the owning lane — see that round's own
 * finding doc for why).
 *
 * Unlike the sibling guard above, this test also asserts the bare literal is
 * GONE, not just that the constant is used somewhere — a route with multiple
 * response branches (success + several error branches) could satisfy
 * "constant used once" while still leaking the bare literal on another
 * branch, which is exactly the shape every one of these seven routes had
 * before this fix (each had 1-4 separate `NextResponse.json(...)` call sites).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

const FIXED_ROUTES = [
  "admin/nighthawk/analytics/route.ts",
  "admin/nighthawk/publish-preview/route.ts",
  "admin/nighthawk/regrade-stuck-outcomes/route.ts",
  "admin/playbook/fsm-today/route.ts",
  "admin/playbook/promotion-report/route.ts",
  "admin/zerodte/health/route.ts",
  "admin/zerodte/regrade-index-roots/route.ts",
];

// Matches the exact dead-literal shape these routes previously shipped:
// `{ "Cache-Control": "no-store" }`, with or without surrounding whitespace,
// as either a double- or single-quoted key/value pair.
const BARE_LITERAL = /["']Cache-Control["']\s*:\s*["']no-store["']/;

test("fixed admin nighthawk/playbook/zerodte routes actually apply NO_STORE_HEADERS, not a bare Cache-Control literal", () => {
  for (const rel of FIXED_ROUTES) {
    const abs = join(process.cwd(), "src/app/api", rel);
    const src = readFileSync(abs, "utf8");

    assert.match(
      src,
      /from\s*["']@\/lib\/no-store-headers["']/,
      `${rel}: expected an import of NO_STORE_HEADERS`
    );

    // Every response in these routes must use the real constant; a bare
    // Cache-Control-only literal anywhere in the file is the regression this
    // guard exists to catch (it previously existed on the success path AND
    // on every error branch across these seven routes).
    assert.doesNotMatch(
      src,
      BARE_LITERAL,
      `${rel}: still sets a bare { "Cache-Control": "no-store" } literal instead of ` +
        `spreading/using the imported NO_STORE_HEADERS constant`
    );

    const usesConstant = /headers:\s*(\{\s*\.\.\.)?NO_STORE_HEADERS/.test(src);
    assert.ok(usesConstant, `${rel}: imports NO_STORE_HEADERS but a response never applies it`);
  }
});

test("NO_STORE_HEADERS still carries the CDN-scoped bypass keys this guard depends on", () => {
  assert.equal(NO_STORE_HEADERS["CDN-Cache-Control"], "no-store");
  assert.equal(NO_STORE_HEADERS["Cloudflare-CDN-Cache-Control"], "no-store");
});
