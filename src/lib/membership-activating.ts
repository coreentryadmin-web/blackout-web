import type { CheckoutPlan } from "@/lib/analytics/checkout-plans";
import { resolveDisplayTier, tierAtLeast, type Tier } from "@/lib/tiers";

/** Poll interval while waiting for billing sync → Clerk tier after checkout return. */
export const MEMBERSHIP_ACTIVATION_POLL_MS = 3_000;

/** ~2 minutes of polling before surfacing manual sync guidance. */
export const MEMBERSHIP_ACTIVATION_MAX_ATTEMPTS = 40;

export function isPaidTier(tier: Tier): boolean {
  return tierAtLeast(tier, "community");
}

/**
 * True when the member recently clicked checkout (plan remembered in localStorage) but Clerk
 * metadata still shows free — the post-pay activation window CLQ-041 called out.
 */
export function shouldPollMembershipActivation(opts: {
  isLoaded: boolean;
  isSignedIn: boolean;
  tier: string | null;
  rememberedPlan: CheckoutPlan | null;
}): boolean {
  if (!opts.isLoaded || !opts.isSignedIn || !opts.rememberedPlan) return false;
  // resolveDisplayTier: admin sessions read as premium for gating — must not poll (CLQ-041 / #3971).
  return !isPaidTier(resolveDisplayTier(opts.tier ?? "free"));
}

export function tierFromMembershipSyncBody(data: unknown): Tier | null {
  if (!data || typeof data !== "object") return null;
  const tier = (data as { tier?: unknown }).tier;
  if (tier === "premium" || tier === "community") return tier;
  if (tier === "free") return "free";
  return null;
}
