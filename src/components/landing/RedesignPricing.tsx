"use client";

import Link from "next/link";
import { BorderBeam } from "@/components/ui/motion/BorderBeam";
import { RetroGrid } from "@/components/ui/motion/RetroGrid";
import { CheckoutLink } from "@/components/analytics/CheckoutLink";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";
import { PRICING_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { PLAN_MATRIX } from "@/lib/plan-matrix";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

/** Full-desk perks — every module, one membership. */
const DESK_PERKS = PLAN_MATRIX.premium_monthly.includes;

const SPX_PERKS = PLAN_MATRIX.spx_slayer.includes.slice(0, 4);

/** Redesigned pricing page — three tiers, real perks, the "lights on" language. */
export function RedesignPricing() {
  return (
    <div className="rl">
      <section className="rl-pricing-page">
        {/* Perspective phosphor floor behind the tier grid. */}
        <RetroGrid lineColor="rgba(191,95,255,0.16)" opacity={0.42} />
        <div className="rl-wrap">
          <div className="rl-pricing-head">
            <span className="rl-kicker" style={{ justifyContent: "center" }}>
              <span className="dot" aria-hidden />Membership
            </span>
            <h1>One desk. <span className="rl-gt">Your price.</span></h1>
            <p>SPX Slayer or the full desk — monthly or yearly. Priced for traders who already pay for edge. No broker lock-in, cancel anytime.</p>
          </div>

          <div className="rl-tier-grid">
            {/* SPX Slayer */}
            <div className="rl-plan">
              <div className="pl">SPX Slayer</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.community)}<span> / mo</span></div>
              <div className="save">SPX structure · 0DTE desk · graded plays</div>
              <ul className="perks">
                {SPX_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <CheckoutLink
                href={WHOP_CHECKOUT.community || "/sign-up?redirect_url=%2Fupgrade"}
                plan="community"
                campaignSource="pricing"
                campaign="spx_slayer"
                className="rl-btn rl-btn-ghost"
              >
                Get SPX access
              </CheckoutLink>
              <p className="trust">Cancel anytime · no contracts</p>
            </div>

            {/* Premium Monthly — featured */}
            <div className="rl-plan feat">
              {/* Border beam marks the recommended tier — bull-green to match its accent. */}
              <BorderBeam color="var(--rl-bull)" duration="6s" width="1.6px" />
              <div className="badge">Full desk</div>
              <div className="pl">Premium · Monthly</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.monthly)}<span> / mo</span></div>
              <div className="save">Every module · one membership</div>
              <ul className="perks">
                {DESK_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <CheckoutLink
                href={WHOP_CHECKOUT.monthly || "/sign-up?redirect_url=%2Fupgrade"}
                plan="monthly"
                campaignSource="pricing"
                campaign="premium_monthly"
                className="rl-btn rl-btn-primary"
              >
                Start monthly →
              </CheckoutLink>
              <p className="trust">Cancel anytime · no contracts</p>
            </div>

            {/* Premium Yearly */}
            <div className="rl-plan">
              <div className="pl">Premium · Yearly</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.yearly)}<span> / yr</span></div>
              <div className="save">≈ ${MEMBERSHIP_PRICING.yearlyEffectiveMonthly}/mo · save ${MEMBERSHIP_PRICING.yearlySavingsVsMonthly} vs monthly</div>
              <ul className="perks">
                {DESK_PERKS.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <CheckoutLink
                href={WHOP_CHECKOUT.yearly || "/sign-up?redirect_url=%2Fupgrade"}
                plan="yearly"
                campaignSource="pricing"
                campaign="premium_yearly"
                className="rl-btn rl-btn-ghost"
              >
                Go yearly
              </CheckoutLink>
              <p className="trust">7-day money-back guarantee · cancel anytime</p>
            </div>
          </div>

          <FeatureComparison />

          <section className="rl-pricing-faq" aria-label="Pricing FAQ">
            <h2>Questions?</h2>
            {selectFaqItems(PRICING_FAQ_IDS).map((item) => (
              <details className="faq-item" key={item.id}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
            <p className="trust" style={{ marginTop: "1.5rem" }}>
              <Link href="/refund-policy" prefetch={false}>Full refund policy →</Link>
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
