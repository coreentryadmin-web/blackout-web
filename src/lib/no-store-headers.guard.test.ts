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

/** Paths that may intentionally omit no-store (public CDN TTL or non-JSON plumbing). */
const ALLOWLIST = new Set([
  "src/app/api/market/news/route.ts",
  "src/app/api/market/regime/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/ready/route.ts",
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
