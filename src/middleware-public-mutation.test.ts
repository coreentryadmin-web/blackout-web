import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Public POST routes must be exempted from the middleware's blanket mutation guard.
 *
 * `middleware-clerk.ts` rejects every POST/PUT/PATCH/DELETE to /api/* that arrives without a
 * Bearer token or a Clerk cookie. That runs BEFORE the route, so a handler being public in its own
 * code is irrelevant — and `scripts/verify-api-auth-guards.mjs` cannot see this, because it is a
 * static scan of route source with no model of middleware. The result is a route that returns 401
 * to precisely the audience it was built for, while CI stays entirely green.
 *
 * That is not hypothetical: /api/public/email-capture shipped and never once worked for an
 * anonymous visitor. Only a live signed-out request surfaced it. These tests make the coupling
 * explicit so the next public POST route cannot repeat it.
 */

const MW = "src/middleware-clerk.ts";
const API_ROOT = "src/app/api";

function mw(): string {
  return readFileSync(MW, "utf8");
}

/** Every route.ts under src/app/api/public/** that exports a mutation handler. */
function publicMutationRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const src = readFileSync(p, "utf8");
        if (/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(src)) out.push(p);
      }
    }
  };
  walk(join(API_ROOT, "public"));
  return out;
}

test("the mutation guard consults a public-mutation exemption", () => {
  const src = mw();
  assert.match(src, /const isPublicMutationRoute = createRouteMatcher\(/, "exemption matcher must exist");
  assert.match(src, /!isPublicMutationRoute\(req\)/, "the guard must actually consult it");
});

test("every public route with a mutation handler is in the exemption list", () => {
  // The load-bearing test. A new public POST route added without a matcher entry fails here
  // instead of silently 401-ing in production.
  const src = mw();
  const matcherBlock = src.slice(
    src.indexOf("const isPublicMutationRoute = createRouteMatcher("),
    src.indexOf("export default clerkMiddleware")
  );
  for (const file of publicMutationRoutes()) {
    // src/app/api/public/email-capture/route.ts -> /api/public/email-capture
    const urlPath = "/" + file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
    assert.ok(
      matcherBlock.includes(`"${urlPath}"`),
      `${urlPath} accepts mutations but is not in isPublicMutationRoute — it will 401 for logged-out callers`
    );
  }
});

test("the exemption is narrow — no wildcard over /api/public", () => {
  // A `/api/public/(.*)` matcher would auto-exempt every future public route, including ones with
  // no abuse controls. Each addition should be a deliberate line.
  const src = mw();
  const block = src.slice(
    src.indexOf("const isPublicMutationRoute = createRouteMatcher("),
    src.indexOf("export default clerkMiddleware")
  );
  assert.ok(!/\/api\/public\/\(\.\*\)/.test(block), "must not blanket-exempt all of /api/public");
  assert.ok(!/\(\.\*\)/.test(block), "no wildcards — list each public mutation route explicitly");
});

test("webhook and telemetry exemptions are unchanged", () => {
  // Regression guard: the fix adds a third exemption, it does not replace the existing two.
  const src = mw();
  assert.match(src, /!isWebhookRoute\(req\)/);
  assert.match(src, /!isPublicTelemetryRoute\(req\)/);
});

test("email-capture keeps its own abuse controls, since middleware no longer gates it", () => {
  // Exempting a route from auth is only safe while the route defends itself.
  const route = readFileSync("src/app/api/public/email-capture/route.ts", "utf8");
  assert.match(route, /checkIpRateLimit\(ip,/, "per-caller IP rate limit");
  assert.match(route, /public:email-capture:recipient/, "per-recipient send cooldown");
  assert.match(route, /isValidEmail\(/, "address validation");
  assert.match(route, /MAX_BODY_FIELD_LEN/, "body field length caps");
});
