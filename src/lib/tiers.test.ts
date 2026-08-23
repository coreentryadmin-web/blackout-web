/**
 * Regression guard for the admin-tier client-display fallthrough (docs/audit/UI-UX-MAP.md §1.2b,
 * docs/audit/UI-UX-OPPORTUNITIES.md item 8, 2026-08-23): `ClerkAuthBridge`
 * (src/lib/auth-client.tsx) sets `useAppAuth().tier` to the synthetic string "admin" for
 * `role:admin` users, specifically so admin members "bypass client-side Premium gates" (that
 * file's own comment) — but `parseTier` never recognized "admin" and silently fell through to
 * "free". Traced statically to two real client consumers that fed `useAppAuth().tier` straight
 * into `parseTier`: `AccountMembershipPanel` (the /account "Current plan" card) and `PlanLadder`
 * (the /pricing, /upgrade CTAs) — both would show a real, hydrated admin member as "Free" with a
 * not-yet-subscribed upgrade prompt, despite already having full access. `resolveDisplayTier` is
 * the fix, and it's a NEW function rather than a change to `parseTier` itself: `Ga4ConversionTracker`
 * also calls `parseTier` on this exact same `useAppAuth().tier` value to detect a tier upgrade and
 * fire a purchase-conversion event, and folding "admin"→"premium" into `parseTier` would make every
 * admin page load read as a brand-new premium purchase on mount, firing a false conversion event.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTier, resolveDisplayTier, tierAtLeast } from "./tiers";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("parseTier: does not recognize the synthetic admin tier string (by design — see resolveDisplayTier)", () => {
  assert.equal(parseTier("admin"), "free");
});

test("resolveDisplayTier: treats the admin tier string as premium", () => {
  assert.equal(resolveDisplayTier("admin"), "premium");
  assert.ok(tierAtLeast(resolveDisplayTier("admin"), "premium"));
});

test("resolveDisplayTier: defers to parseTier for every non-admin value", () => {
  for (const value of ["premium", "pro", "elite", "community", "free", "", null, undefined, "bogus"]) {
    assert.equal(resolveDisplayTier(value), parseTier(value));
  }
});

test("AccountMembershipPanel: reads the account tier via resolveDisplayTier, not parseTier", () => {
  const src = read("src/components/account/AccountMembershipPanel.tsx");
  assert.match(src, /resolveDisplayTier\(rawTier\)/, "must resolve the admin-synthetic tier or a real admin sees Free + an Upgrade CTA on their own account page");
  assert.doesNotMatch(src, /\bparseTier\(/, "must not fall back to the bare parseTier — that's exactly the bug this fixes");
});

test("PlanLadder: reads the pricing/upgrade CTA tier via resolveDisplayTier, not parseTier", () => {
  const src = read("src/components/upgrade/PlanLadder.tsx");
  assert.match(src, /resolveDisplayTier\(tier/, "must resolve the admin-synthetic tier or a real admin sees the full not-yet-subscribed ladder on /pricing and /upgrade");
  assert.doesNotMatch(src, /\bparseTier\(/, "must not fall back to the bare parseTier — that's exactly the bug this fixes");
});

test("Ga4ConversionTracker: deliberately keeps calling parseTier, NOT resolveDisplayTier", () => {
  const src = read("src/components/analytics/Ga4ConversionTracker.tsx");
  assert.match(src, /parseTier\(/, "must keep treating the admin tier as non-purchasing — resolveDisplayTier here would fire a false purchase-conversion event on every admin page load");
  assert.doesNotMatch(src, /resolveDisplayTier/, "resolveDisplayTier must not leak into the purchase-conversion tracker");
});
