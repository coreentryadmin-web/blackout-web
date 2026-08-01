/**
 * Guard: the /api/* headers() rule always applies a no-store Cache-Control floor, in every
 * environment — not gated on isStagingSite (permanently false since staging was decommissioned,
 * which was the actual P0 bug: production's catch-all contributed zero Cache-Control to the whole
 * API tree). See docs/audit/FINDINGS.md (2026-08-01 CTO perf audit) for the full writeup.
 *
 * Run: npx tsx --test next.config.headers.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "./next.config.mjs";

test("headers(): /api/:path* rule exists and sets no-store Cache-Control unconditionally", async () => {
  const rules = await nextConfig.headers();
  const apiRule = rules.find((r) => r.source === "/api/:path*");
  assert.ok(apiRule, "expected an explicit /api/:path* headers() rule");

  const byKey = Object.fromEntries(apiRule.headers.map((h) => [h.key, h.value]));
  assert.match(byKey["Cache-Control"], /no-store/);
  assert.equal(byKey["CDN-Cache-Control"], "no-store");
  assert.equal(byKey["Cloudflare-CDN-Cache-Control"], "no-store");
});

test("headers(): the api rule is NOT conditional on isStagingSite (env-independent)", () => {
  // Read the source directly rather than re-importing under a different env — Next.js config
  // modules aren't safely re-evaluatable per-process-env within one test run — and assert the
  // /api/:path* rule's headers array is a plain unconditional spread, not an isStagingSite ternary
  // like the catch-all rule directly above it (the exact bug this fix closes).
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "next.config.mjs"),
    "utf8"
  );
  const apiRuleMatch = src.match(/source:\s*"\/api\/:path\*"[\s\S]{0,80}headers:\s*([^\n]+)/);
  assert.ok(apiRuleMatch, "could not locate the /api/:path* rule in next.config.mjs");
  assert.doesNotMatch(
    apiRuleMatch[1],
    /isStagingSite/,
    "the /api/:path* rule must apply unconditionally — isStagingSite is permanently false in production"
  );
});

test("headers(): catch-all rule excludes api/ (no double-application of securityHeaders)", async () => {
  const rules = await nextConfig.headers();
  const catchAll = rules.find((r) => r.source.startsWith("/((?!"));
  assert.ok(catchAll, "expected the catch-all rule");
  assert.match(catchAll.source, /api\//, "catch-all's negative lookahead must exclude api/");
});
