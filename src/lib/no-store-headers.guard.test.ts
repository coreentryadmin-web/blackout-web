/**
 * Guard: live/auth-gated API routes must import NO_STORE_HEADERS (or the stream
 * variant) so Cloudflare cannot edge-cache member-specific JSON under
 * override_origin. Intentional public CDN exceptions are listed below.
 *
 * Run: npx tsx --test src/lib/no-store-headers.guard.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** Prefixes that MUST use the shared no-store constant. */
const REQUIRED_PREFIXES = [
  "src/app/api/market/",
  "src/app/api/auth/me",
  "src/app/api/account/",
  "src/app/api/membership/",
  "src/app/api/mobile/",
  "src/app/api/track-record/",
  "src/app/api/public/track-record/",
  "src/app/api/signals/",
  "src/app/api/brief/",
  "src/app/api/coaching/",
  "src/app/api/platform/",
  // 2026-08-01 audit: these four prefixes were never covered, so nothing caught
  // admin/errors, admin/health, admin/signal-analytics, and a dozen other
  // admin-dashboard routes serving sensitive JSON with zero cache headers, or the
  // /api/engine proxy route serving premium-tier-gated heatmap/nighthawk data.
  "src/app/api/admin/",
  "src/app/api/nighthawk/",
  "src/app/api/webhook/",
  "src/app/api/webhooks/",
  "src/app/api/engine/",
];

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

test("required API route prefixes import shared no-store headers", () => {
  const routes = walk(API_ROOT);
  const offenders: string[] = [];
  for (const abs of routes) {
    const rel = abs.replace(process.cwd() + "/", "");
    if (ALLOWLIST.has(rel)) continue;
    if (!REQUIRED_PREFIXES.some((p) => rel.startsWith(p) || rel === p + "route.ts" || rel.startsWith(p))) {
      // auth/me special-case
      if (!rel.startsWith("src/app/api/auth/me")) continue;
    }
    if (rel.includes("/cron/")) continue;
    const src = readFileSync(abs, "utf8");
    const ok =
      src.includes('from "@/lib/no-store-headers"') ||
      src.includes("from '@/lib/no-store-headers'");
    if (!ok) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `routes missing no-store-headers import:\n${offenders.join("\n")}`);
});
