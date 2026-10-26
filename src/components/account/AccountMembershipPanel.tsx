"use client";

import Link from "next/link";
import { useAppAuth } from "@/lib/auth-client";
import { resolveDisplayTier, TIER_LABELS, type Tier } from "@/lib/tiers";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

/**
 * `useAppAuth().tier` defaults to `null` until Clerk finishes loading, and
 * `resolveDisplayTier(null)` resolves that to `"free"` — so reading tier
 * straight off `useAppAuth()` without checking `isLoaded` first flashes the
 * FREE-tier UI (an "Upgrade" CTA) for every member, including already-paying
 * ones, during the load window. Returning `tier: null` while loading (instead
 * of resolving a tier at all) is what lets the component render nothing
 * tier-dependent until the real value is known.
 */
export function resolveMembershipPanelView(
  rawTier: string | null,
  isLoaded: boolean
): { tier: Tier | null } {
  if (!isLoaded) return { tier: null };
  // resolveDisplayTier (not parseTier): an admin member's rawTier is the synthetic "admin"
  // string, which parseTier doesn't recognize and falls through to "free" — see tiers.ts.
  return { tier: resolveDisplayTier(rawTier) };
}

/**
 * Billing lives entirely with our checkout partner — there is no in-app
 * cancel/downgrade control. This panel is the one place `/account` tells
 * members the truth about that and links them straight to the billing
 * portal instead of a dead end.
 */
export function AccountMembershipPanel() {
  const { tier: rawTier, isLoaded } = useAppAuth();
  const { tier } = resolveMembershipPanelView(rawTier, isLoaded);
  const manageHref = WHOP_CHECKOUT.store || WHOP_CHECKOUT.monthly || WHOP_CHECKOUT.community;

  return (
    <div className="account-page-membership-block mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="font-syne text-lg font-bold text-white">Membership &amp; Billing</h2>
      <p className="font-mono text-[11px] text-sky-300/60 mt-1 mb-4 uppercase tracking-[0.1em]">
        Plan · Payment method · Cancel
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300/60">
            Current plan
          </p>
          <p className="text-white font-semibold mt-1">
            {tier ? TIER_LABELS[tier] : "Loading…"}
          </p>
        </div>

        {tier === "free" ? (
          <Link href="/upgrade" className="btn-primary-bull">
            Upgrade
          </Link>
        ) : tier && manageHref ? (
          <a
            href={manageHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline-bull"
          >
            Manage subscription
          </a>
        ) : null}
      </div>

      {tier && tier !== "free" && (
        <p className="font-mono text-[11px] text-sky-300/60 mt-3 leading-relaxed">
          Billing is handled by our secure checkout partner. &quot;Manage subscription&quot;
          opens your billing portal — update your card, switch plans, or
          cancel there. Questions about a charge? Email{" "}
          <a href="mailto:billing@blackouttrades.com" className="text-sky-300 hover:text-white">
            billing@blackouttrades.com
          </a>
          .
        </p>
      )}
    </div>
  );
}
