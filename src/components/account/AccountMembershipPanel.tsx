"use client";

import { useAppAuth } from "@/lib/auth-client";
import { parseTier, TIER_LABELS } from "@/lib/tiers";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

/**
 * Billing lives entirely with our checkout partner — there is no in-app
 * cancel/downgrade control. This panel is the one place `/account` tells
 * members the truth about that and links them straight to the billing
 * portal instead of a dead end.
 */
export function AccountMembershipPanel() {
  const { tier: rawTier, isLoaded } = useAppAuth();
  const tier = parseTier(rawTier);
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
            {isLoaded ? TIER_LABELS[tier] : "Loading…"}
          </p>
        </div>

        {tier === "free" ? (
          <a href="/upgrade" className="btn-primary-bull">
            Upgrade
          </a>
        ) : manageHref ? (
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

      {tier !== "free" && (
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
