import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Network-free assertions. The module is mostly a thin Whop v1 client, so the things worth pinning
// are the ones that would silently mislead a member if they regressed — not the HTTP plumbing.

test("no synthesized affiliate share link is ever produced", () => {
  // A guessed affiliate URL that doesn't actually attribute is worse than none: the member shares
  // it, earns nothing, and blames us. Whop's affiliate record exposes no link field (verified
  // live), so the module must send members to Whop's own dashboard instead of inventing a format.
  const src = readFileSync("src/lib/whop-affiliates.ts", "utf8");
  assert.doesNotMatch(src, /\?a=\$\{/, "must not build a ?a=<username> link from a guessed format");
  assert.match(src, /WHOP_AFFILIATE_DASHBOARD_URL/, "must expose Whop's own dashboard as the link source");
});

test("the affiliate API is pinned to v1 — v2 has no affiliate routes", () => {
  // /api/v2/* answers EVERY unrouted path with a blanket 401 that reads like a scope error, which
  // is how this was mis-diagnosed twice. v1 is the real affiliate surface and returns honest 404s.
  const src = readFileSync("src/lib/whop-affiliates.ts", "utf8");
  assert.match(src, /api\.whop\.com\/v1/, "affiliates live on v1");
  assert.doesNotMatch(src, /api\.whop\.com\/api\/v2\/affiliates/, "v2 has no affiliate routes");
});

test("money and percent fields are passed through, never parsed", () => {
  // Whop returns PRE-FORMATTED display strings ("$0.00", "0.0%"). Parsing them into numbers is how
  // a UI ends up disagreeing with the payment processor's own figures.
  const routeSrc = readFileSync("src/app/api/referrals/me/route.ts", "utf8");
  assert.doesNotMatch(routeSrc, /parseFloat\(|Number\(a\.total_referral_earnings_usd/, "do not parse Whop money strings");
  assert.match(routeSrc, /earnings: a\.total_referral_earnings_usd/, "pass earnings through verbatim");
});

test("an upstream failure reports degraded rather than a zeroed scoreboard", () => {
  // Rendering "0 referrals / $0.00" when Whop is unreachable reads to a member as "my earnings
  // vanished". The route must distinguish 'not enrolled' from 'could not check'.
  const routeSrc = readFileSync("src/app/api/referrals/me/route.ts", "utf8");
  assert.match(routeSrc, /degraded = true/, "route must flag degraded on upstream failure");
  const panelSrc = readFileSync("src/components/account/ReferralPanel.tsx", "utf8");
  assert.match(panelSrc, /data\?\.degraded/, "panel must branch on degraded before rendering stats");
});

test("the custom referral machinery this replaces is fully removed", () => {
  // The whole point: Whop already owns attribution, commission and payout. Leaving a half-built
  // first-party referral table alongside it is how two sources of truth get created.
  for (const gone of [
    "src/lib/referrals.ts",
    "src/lib/analytics/referral-client.ts",
    "src/app/api/referrals/attribute/route.ts",
    "src/lib/migrations/010_referrals.sql",
  ]) {
    assert.throws(() => readFileSync(gone, "utf8"), `${gone} must be deleted`);
  }
  const db = readFileSync("src/lib/db.ts", "utf8");
  assert.doesNotMatch(db, /CREATE TABLE IF NOT EXISTS referrals/, "referrals table migration must be gone");
  const webhook = readFileSync("src/app/api/webhook/whop/route.ts", "utf8");
  assert.doesNotMatch(webhook, /markReferralConverted/, "webhook referral hook must be gone");
});
