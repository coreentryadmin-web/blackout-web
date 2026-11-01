"use client";

import { useEffect, useRef } from "react";
import { useAppAuth } from "@/lib/auth-client";
import { ga4Available, hasPurchaseFired, markPurchaseFired, trackGa4Event } from "@/lib/analytics/ga4-client";
import { GA4_EVENTS } from "@/lib/analytics/ga4-events";
import { trackXEvent } from "@/lib/analytics/x-pixel";
import {
  clearRememberedPlan,
  purchaseValueUsd,
  readRememberedPlan,
} from "@/lib/analytics/checkout-plans";
import { parseTier } from "@/lib/tiers";
import { purchaseFiredKey, shouldFirePurchaseConversion } from "@/lib/analytics/purchase-tracking";
import { purchaseTransactionId, trackGoogleAdsConversion } from "@/lib/analytics/google-ads";

/** Fire purchase when tier upgrades to a paid plan (post-Whop checkout return). */
export function Ga4ConversionTracker() {
  const { isLoaded, isSignedIn, userId, tier } = useAppAuth();
  const prevTier = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;

    const current = parseTier(tier ?? "free");
    const previous = prevTier.current ? parseTier(prevTier.current) : null;
    prevTier.current = tier ?? "free";

    // See shouldFirePurchaseConversion's own doc comment for the bug this fixes: the old
    // "paid now AND was not already paid before" gate swallowed every upgrade past the member's
    // first paid tier (community -> premium never fired), because "already paid" was true the
    // moment they were on ANY paid tier, not just the one they're upgrading FROM this moment.
    if (!shouldFirePurchaseConversion(current, previous)) return;
    // Scoped per (member, tier reached) — not per member for life — so a genuine upgrade gets its
    // own flag instead of being blocked forever by the flag the member's first purchase set.
    const purchaseKey = purchaseFiredKey(userId, current);
    if (hasPurchaseFired(purchaseKey)) return;
    // gtag may not have finished its strategy="afterInteractive" load yet on a fresh page load
    // (exactly how a user reaches this component: a hard redirect back from the Whop checkout
    // round-trip). Don't persist the fired flag until we know the call will actually reach gtag —
    // persisting it unconditionally (the prior behavior) would permanently block every future
    // attempt for this user via localStorage, which survives a refresh unlike the sign-up flag's
    // sessionStorage. Leaving it unmarked lets a refresh (which re-runs the same script-load race)
    // retry.
    if (!ga4Available()) return;
    markPurchaseFired(purchaseKey);

    // Value the purchase from the plan the member actually clicked (recovered across the Whop
    // round-trip) so a yearly buyer is booked at $1999, not the $199 a tier-only lookup would give
    // — begin_checkout and purchase now reconcile. Falls back to the tier estimate when no fresh
    // plan is stored. Clear it afterward so a later re-fire can't reuse a stale plan.
    const purchaseValue = purchaseValueUsd(current, readRememberedPlan());
    clearRememberedPlan();

    trackGa4Event(GA4_EVENTS.purchase, {
      tier: current,
      transaction_id: userId,
      value: purchaseValue,
      currency: "USD",
    });
    trackXEvent("tw-re1j3-re9zc", {
      value: purchaseValue,
      currency: "USD",
    });
    // PRIMARY, and the one that carries money. A flat-value Purchase would teach Smart Bidding
    // that a $49 community signup and a $1,999 annual are worth the same, and it would buy ten of
    // the former; `purchaseValue` is the plan the member actually clicked, recovered across the
    // Whop round-trip.
    //
    // transaction_id is keyed on user AND tier, not the bare userId GA4 uses above. Google dedupes
    // on this value, so a lifetime-stable id would collapse a later upgrade into the original
    // purchase and drop it — silently losing exactly the highest-value conversions.
    trackGoogleAdsConversion("purchase", {
      value: purchaseValue,
      currency: "USD",
      transactionId: purchaseTransactionId(userId, current),
    });
  }, [isLoaded, isSignedIn, userId, tier]);

  return null;
}
