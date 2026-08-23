export type Tier = "free" | "community" | "premium";

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  community: 1,
  premium: 2,
};

export function parseTier(value: unknown): Tier {
  if (value === "premium" || value === "pro" || value === "elite") return "premium";
  if (value === "community") return "community";
  return "free";
}

/**
 * Client-DISPLAY tier only — NOT a substitute for `parseTier`.
 *
 * `ClerkAuthBridge` (src/lib/auth-client.tsx) sets `useAppAuth().tier` to the synthetic string
 * "admin" for `publicMetadata.role === "admin"` users, specifically so admin members "bypass
 * client-side Premium gates" (that file's own comment). But `parseTier` has never recognized
 * "admin" as one of its inputs, so every client component that fed `useAppAuth().tier` straight
 * into `parseTier` silently fell through to "free" for real admin members — their own /account
 * page showed "Free" + an Upgrade CTA, and /pricing, /upgrade showed the full not-yet-subscribed
 * ladder, despite already having full access. This wrapper is the fix, used ONLY by
 * display/CTA-gating consumers (AccountMembershipPanel, PlanLadder).
 *
 * Deliberately NOT folded into `parseTier` itself: `Ga4ConversionTracker` also calls `parseTier`
 * on the same `useAppAuth().tier` value to detect a tier UPGRADE and fire a purchase-conversion
 * event. Admin sessions never purchase anything — if "admin" mapped to "premium" inside
 * `parseTier`, every admin page load would read as a brand-new premium upgrade on mount (prior
 * tier ref starts null) and fire a false purchase/conversion event, polluting GA4 and Google Ads
 * conversion data. `parseTier` must keep returning "free" for the literal string "admin" so that
 * tracker stays correct; this wrapper carries the display-only interpretation instead.
 */
export function resolveDisplayTier(value: unknown): Tier {
  if (value === "admin") return "premium";
  return parseTier(value);
}

export function tierAtLeast(have: Tier, need: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  community: "SPX Slayer",
  premium: "Premium",
};
