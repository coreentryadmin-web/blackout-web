/**
 * Regression guard for the exact bug class found live in admin/gex/health,
 * admin/helix/health, admin/cron-health and admin/options-socket (2026-11-01 audit):
 * each route imported NO_STORE_HEADERS from "@/lib/no-store-headers" but never
 * applied it to a response — it set a bare `{ "Cache-Control": "no-store" }`
 * literal instead, which is missing the CDN-scoped CDN-Cache-Control /
 * Cloudflare-CDN-Cache-Control headers that actually stop a Cloudflare cache
 * rule with `override_origin` from edge-caching the response (see the doc
 * comment on NO_STORE_HEADERS in src/lib/no-store-headers.ts).
 *
 * The repo's existing src/lib/no-store-headers.guard.test.ts only checks that a
 * route IMPORTS the constant somewhere in the file — it cannot tell an import
 * from a dead import, which is precisely how these four shipped broken despite
 * that guard already existing (that guard test's own file history records this
 * exact limitation, first hit on admin/analytics/x and admin/spx/health on
 * 2026-08-01, then recurring here on four more siblings never swept at the time).
 *
 * Scoped deliberately to these four already-fixed routes rather than every API
 * route repo-wide: several other routes (admin/nighthawk/*, admin/playbook/*,
 * admin/zerodte/*, market/*../stream) have the same latent defect as of this
 * writing but belong to actively-worked lanes this audit round does not touch —
 * see docs/audit/findings-staging/2026-11-01-admin-health-routes-missing-cdn-nostore-headers.md
 * for the full list. Widening this guard to cover them is a follow-up, not this fix.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

const FIXED_ROUTES = [
  "admin/gex/health/route.ts",
  "admin/helix/health/route.ts",
  "admin/cron-health/route.ts",
  "admin/options-socket/route.ts",
];

test("fixed admin health/status routes actually apply NO_STORE_HEADERS, not a bare Cache-Control literal", () => {
  for (const rel of FIXED_ROUTES) {
    const abs = join(process.cwd(), "src/app/api", rel);
    const src = readFileSync(abs, "utf8");
    assert.match(
      src,
      /from\s*["']@\/lib\/no-store-headers["']/,
      `${rel}: expected an import of NO_STORE_HEADERS`
    );
    // The success-path response must spread/reference the actual imported constant
    // (NO_STORE_HEADERS), not merely import it. A bare `{ "Cache-Control": "no-store" }`
    // literal is exactly the regression this guard exists to catch.
    const usesConstant = /headers:\s*(\{\s*\.\.\.)?NO_STORE_HEADERS/.test(src);
    assert.ok(usesConstant, `${rel}: imports NO_STORE_HEADERS but a response never applies it`);
  }
});

test("NO_STORE_HEADERS still carries the CDN-scoped bypass keys this guard depends on", () => {
  assert.equal(NO_STORE_HEADERS["CDN-Cache-Control"], "no-store");
  assert.equal(NO_STORE_HEADERS["Cloudflare-CDN-Cache-Control"], "no-store");
});
