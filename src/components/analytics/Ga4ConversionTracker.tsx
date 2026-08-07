"use client";

import { useEffect, useRef } from "react";
import { useAppAuth } from "@/lib/auth-client";
import { trackGa4Event } from "@/lib/analytics/ga4-client";
import { GA4_EVENTS } from "@/lib/analytics/ga4-events";
import { trackXEvent } from "@/lib/analytics/x-pixel";
import {
  clearRememberedPlan,
  purchaseValueUsd,
  readRememberedPlan,
} from "@/lib/analytics/checkout-plans";
import { tierAtLeast, parseTier } from "@/lib/tiers";

const PURCHASE_FLAG_PREFIX = "bo_ga4_purchase_fired:";

/** Fire purchase when tier upgrades to a paid plan (post-Whop checkout return). */
export function Ga4ConversionTracker() {
  const { isLoaded, isSignedIn, userId, tier } = useAppAuth();
  const prevTier = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;

    const current = parseTier(tier ?? "free");
    const previous = prevTier.current ? parseTier(prevTier.current) : null;
    prevTier.current = tier ?? "free";

    const nowPaid = tierAtLeast(current, "community");
    const wasPaid = previous ? tierAtLeast(previous, "community") : false;

    if (!nowPaid || wasPaid) return;

    try {
      const flagKey = `${PURCHASE_FLAG_PREFIX}${userId}`;
      if (localStorage.getItem(flagKey) === "1") return;
      localStorage.setItem(flagKey, "1");
    } catch {
      /* private mode — still fire once this session */
    }

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
    trackXEvent("tw-re1j3-purchase", {
      value: purchaseValue,
      currency: "USD",
    });
  }, [isLoaded, isSignedIn, userId, tier]);

  return null;
}
