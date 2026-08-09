/**
 * Tier-gate audit: does the $49 "SPX Slayer" (community) plan grant ONLY SPX Slayer?
 *
 * Mints ONE temp Clerk member per tier with the tier set in publicMetadata and
 * NO admin role — requireTier() short-circuits to premium for admins
 * (auth-access.ts), so an admin temp user would pass every gate and prove
 * nothing. Deleted in a finally.
 *
 * No real payment is made. Tier is Whop-driven in production but resolves from
 * the same publicMetadata field, so this exercises the identical gate.
 *
 * EXPECTATIONS (from the route guards):
 *   community -> /dashboard (SPX Slayer) ALLOWED; every other desk REDIRECTED to /upgrade
 *   community -> premium-only APIs DENIED (401/403)
 * A premium-only surface answering 200 to a community member is a paywall bypass.
 *
 * KNOWN LIMITATION — READ BEFORE TRUSTING A RUN. On 2026-08-09 a --tier=premium
 * control produced results byte-identical to --tier=community, including 403 on
 * premium APIs. A premium member denied premium data is impossible if the tier
 * propagated, so the tier written to publicMetadata was NOT reaching the
 * request. tier-cache.ts:151 does read publicMetadata.tier, so the write path is
 * right in principle; the likely culprit is the freshly minted session JWT
 * carrying stale/absent claims, or the 60s tier cache.
 *
 * Until a premium control run PASSES, this harness can only prove
 * "a non-entitled member is denied X" — NOT "the community tier specifically is
 * denied X". Always run the premium control first and treat a failing control
 * as the harness being broken, not the site.
 */
import { mintTierSession } from "./lib/tier-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");

const PAGES = [
  ["/dashboard", "SPX Slayer", "allow"],
  ["/vector", "Vector", "deny"],
  ["/nighthawk", "Night Hawk", "deny"],
  ["/flows", "Helix", "deny"],
  ["/heatmap", "Thermal", "deny"],
  ["/terminal", "Largo", "deny"],
];

const APIS = [
  ["/api/market/zerodte/board", "Night Hawk board", "deny"],
  ["/api/market/flows", "Helix flow", "deny"],
  ["/api/market/flows/stream", "Helix stream", "deny"],
  ["/api/market/gex-heatmap?ticker=SPX", "Thermal heatmap", "deny"],
  ["/api/market/dark-pool", "Helix dark pool", "deny"],
  ["/api/market/vector/universe", "Vector universe", "deny"],
  ["/api/market/spx/desk", "SPX desk", "allow"],
  ["/api/market/spx/pin", "SPX pin", "allow"],
  ["/api/market/quote?symbol=SPY", "quote", "allow"],
];

const tier = process.argv.find((a) => a.startsWith("--tier="))?.split("=")[1] || "community";
const s = await mintTierSession({ appUrl: BASE, tier });
if (s.skip) { console.error(`SKIP: ${s.reason}`); process.exit(2); }

const rows = [];
try {
  for (const [path, label, expect] of PAGES) {
    const r = await fetch(BASE + path, { headers: { Cookie: s.cookieHeader }, redirect: "manual" });
    const loc = r.headers.get("location") || "";
    const gated = r.status >= 300 && r.status < 400 && /upgrade|sign-in/.test(loc);
    const actual = gated ? "deny" : r.status === 200 ? "allow" : `http-${r.status}`;
    rows.push({ kind: "page", path, label, expect, actual, detail: `${r.status}${loc ? " -> " + loc : ""}` });
  }
  for (const [path, label, expect] of APIS) {
    let r, body = "";
    try {
      // Streams never end: cap the read so the audit cannot hang on one.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      r = await fetch(BASE + path, { headers: { Cookie: s.cookieHeader }, signal: ctrl.signal });
      body = (await r.text()).slice(0, 120);
      clearTimeout(t);
    } catch (e) {
      rows.push({ kind: "api", path, label, expect, actual: "error", detail: String(e.message).slice(0, 60) });
      continue;
    }
    const actual = r.status === 200 ? "allow" : r.status === 401 || r.status === 403 ? "deny" : `http-${r.status}`;
    rows.push({ kind: "api", path, label, expect, actual, detail: `${r.status} ${body.replace(/\s+/g, " ").slice(0, 70)}` });
  }
} finally {
  await s.cleanup();
  console.error("temp Clerk user deleted");
}

console.log(`\n=== TIER GATE AUDIT — tier="${tier}" (no admin role) — ${BASE}\n`);
let bypass = 0, overblock = 0;
for (const r of rows) {
  const ok = r.expect === r.actual;
  if (!ok && r.expect === "deny" && r.actual === "allow") bypass++;
  else if (!ok) overblock++;
  console.log(`${ok ? " OK " : "FAIL"}  ${r.kind.padEnd(4)} ${r.label.padEnd(18)} expect=${r.expect.padEnd(5)} got=${String(r.actual).padEnd(9)} ${r.path.slice(0, 42).padEnd(42)} ${r.detail}`);
}
console.log(`\nPAYWALL BYPASS (expected deny, got allow): ${bypass}`);
console.log(`Other mismatches: ${overblock}`);
process.exit(bypass > 0 ? 1 : 0);
