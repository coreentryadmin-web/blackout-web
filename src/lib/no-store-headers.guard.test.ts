/**
 * Guard: live/auth-gated API routes must import NO_STORE_HEADERS (or the stream
 * variant) so Cloudflare cannot edge-cache member-specific JSON under
 * override_origin. Intentional public CDN exceptions are listed below.
 *
 * Run: npx tsx --test src/lib/no-store-headers.guard.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_STORE_HEADERS, NO_STORE_STREAM_HEADERS } from "./no-store-headers";

const API_ROOT = join(process.cwd(), "src/app/api");

/** Paths that may intentionally omit no-store (public CDN TTL, non-JSON plumbing, or
 *  POST-only external webhook receivers that no browser/CDN ever GETs or caches). */
const ALLOWLIST = new Set([
  "src/app/api/market/news/route.ts",
  "src/app/api/market/regime/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/ready/route.ts",
  // Admin-gated boolean health check, same shape as /health and /ready above.
  "src/app/api/engine/health/route.ts",
  // POST-only webhook receivers called server-to-server by Clerk/Whop — never a
  // browser GET, so there is no edge-caching surface for a no-store header to guard.
  "src/app/api/webhook/whop/route.ts",
  "src/app/api/webhook/clerk/route.ts",
  "src/app/api/webhooks/clerk/route.ts",
  "src/app/api/webhook/resend/route.ts",
]);

/**
 * Routes exempt from the shared no-store constant, each with the reason it is safe.
 *
 * WHY THIS IS A DENY-LIST. This guard used to be an ALLOW-list of path prefixes: a route was only
 * checked if it lived under one of ~11 listed trees. That design fails OPEN — a whole new API tree
 * is unguarded until someone remembers to list it. Not hypothetical: that is exactly how `admin/`,
 * `nighthawk/`, `webhook/` and `engine/` went uncovered until the 2026-08-01 audit found admin
 * routes serving sensitive JSON with no cache headers, and those four prefixes were then added
 * reactively. The next new tree would have repeated it.
 *
 * Inverted 2026-08-09: EVERY src/app/api route must import the shared constant unless listed here
 * with a reason. Adding a route tree can no longer skip the check by omission.
 *
 * ON SEVERITY, so this guard is not mistaken for the last line of defence: next.config.mjs's
 * catch-all header rule (source: "/((?!embed/|_next/).*)") already applies no-store + Vary: Cookie
 * to every API path in production. The per-route constant is defence-in-depth and an explicitness
 * convention — this test protects the convention.
 */
const EXEMPT = new Map<string, string>([
  // Infra probes. ALB/ECS health checks poll these; a cached 200 would mask a dead task, which is
  // the opposite of what the endpoint is for. Carry no user data.
  ["src/app/api/health/route.ts", "infra probe, no user data"],
  ["src/app/api/ready/route.ts", "infra probe, no user data"],
  ["src/app/api/worker/health/route.ts", "infra probe, no user data"],
  ["src/app/api/worker/ready/route.ts", "infra probe, no user data"],
  ["src/app/api/worker/boot/route.ts", "infra probe, no user data"],
  // POST-only client sinks — never a browser GET, so no edge-caching surface.
  ["src/app/api/telemetry/auth-failure/route.ts", "POST-only sink"],
  ["src/app/api/telemetry/client-error/route.ts", "POST-only sink"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

test("NO_STORE_HEADERS includes CDN + Cloudflare CDN no-store", () => {
  assert.equal(NO_STORE_HEADERS["CDN-Cache-Control"], "no-store");
  assert.equal(NO_STORE_HEADERS["Cloudflare-CDN-Cache-Control"], "no-store");
  assert.match(NO_STORE_HEADERS["Cache-Control"], /no-store/);
  assert.equal(NO_STORE_STREAM_HEADERS["CDN-Cache-Control"], "no-store");
});

test("EVERY api route imports shared no-store headers unless explicitly exempt", () => {
  const routes = walk(API_ROOT);
  const offenders: string[] = [];
  for (const abs of routes) {
    const rel = abs.replace(process.cwd() + "/", "");
    if (ALLOWLIST.has(rel)) continue;
    if (EXEMPT.has(rel)) continue;
    // Cron routes are bearer-authorised server-to-server calls, never browser-cached.
    if (rel.includes("/cron/")) continue;
    const src = readFileSync(abs, "utf8");
    const ok =
      src.includes('from "@/lib/no-store-headers"') ||
      src.includes("from '@/lib/no-store-headers'");
    if (!ok) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `API routes missing the shared no-store import.\n` +
      `Import NO_STORE_HEADERS, or add the route to EXEMPT with the reason it is safe:\n` +
      offenders.join("\n")
  );
});

test("every EXEMPT entry still exists — stale exemptions cannot silently accumulate", () => {
  const stale = [...EXEMPT.keys()].filter((rel) => !existsSync(rel));
  assert.deepEqual(stale, [], `EXEMPT lists routes that no longer exist:\n${stale.join("\n")}`);
});
