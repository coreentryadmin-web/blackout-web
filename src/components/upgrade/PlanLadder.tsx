import { CheckoutLink } from "@/components/analytics/CheckoutLink";
import {
  WHOP_CHECKOUT,
  WHOP_COMMUNITY_CHECKOUT_OPTION,
  WHOP_PREMIUM_CHECKOUT_OPTIONS,
  WHOP_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "@/lib/whop-checkout";
import { BorderBeam } from "@/components/ui/motion/BorderBeam";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { PLAN_MATRIX } from "@/lib/plan-matrix";
import { useAppAuth } from "@/lib/auth-client";
import { tierAtLeast, resolveDisplayTier } from "@/lib/tiers";

const COMMUNITY_FEATURES = PLAN_MATRIX.spx_slayer.includes;
const PREMIUM_FEATURES = PLAN_MATRIX.premium_monthly.includes;

export function PlanLadder() {
  const { tier, isLoaded } = useAppAuth();
  // resolveDisplayTier (not parseTier): an admin member's tier is the synthetic "admin" string,
  // which parseTier doesn't recognize and falls through to "free" — see tiers.ts.
  const userTier = resolveDisplayTier(tier ?? "");
  const hasCommunity = isLoaded && tierAtLeast(userTier, "community");
  const hasPremium = isLoaded && tierAtLeast(userTier, "premium");

  const hasAnyOption = WHOP_COMMUNITY_CHECKOUT_OPTION || WHOP_PREMIUM_CHECKOUT_OPTIONS.length > 0;

  if (!hasAnyOption) {
    return WHOP_CHECKOUT.store ? (
      <a href={WHOP_CHECKOUT.store} target="_blank" rel="noopener noreferrer" className="btn-primary">
        View plans →
      </a>
    ) : (
      <p className="text-bear text-sm">{WHOP_CHECKOUT_UNAVAILABLE_MESSAGE}</p>
    );
  }

  const monthlyOption = WHOP_PREMIUM_CHECKOUT_OPTIONS.find((o) => o.label.includes("Monthly"));
  const yearlyOption = WHOP_PREMIUM_CHECKOUT_OPTIONS.find((o) => o.label.includes("Yearly"));

  return (
    <div className="mx-auto max-w-5xl">
      {/* Yearly hero card — full width, dominant */}
      {yearlyOption && (
        <div className="plan-card-yearly relative overflow-hidden rounded-2xl border-2 border-bull/50 bg-gradient-to-br from-[#111a07] via-[#080a10] to-[#121a0a] p-8 text-left md:p-10">
          <BorderBeam color="var(--sig-bull)" duration="6s" width="2px" />
          <div className="absolute inset-0 bg-gradient-to-r from-bull/[0.06] via-transparent to-bull/[0.03] pointer-events-none" />

          <div className="relative flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="flex-1">
              <span className="inline-block rounded-full bg-bull px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-black">
                Best value — save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)}
              </span>
              <h3 className="mt-5 font-syne text-3xl font-bold text-white md:text-4xl">
                Premium Yearly
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/50">
                Full platform access. Every instrument, every tool, every edge — for the price of fewer than two monthly payments.
              </p>

              <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
                    <span className="mt-0.5 text-bull">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col items-start gap-4 md:items-end md:text-right">
              <div>
                <p className="font-anton text-5xl leading-none text-white md:text-6xl">
                  {usd(MEMBERSHIP_PRICING.yearly)}
                </p>
                <p className="mt-1.5 text-sm text-white/40">
                  ≈ {usd(MEMBERSHIP_PRICING.yearlyEffectiveMonthly)}/mo · billed yearly
                </p>
              </div>

              {hasPremium ? (
                <span className="inline-flex items-center justify-center rounded-xl border-2 border-bull/50 bg-bull/10 px-8 py-4 font-syne text-sm font-extrabold uppercase tracking-[0.12em] text-bull">
                  Current Plan
                </span>
              ) : (
                <CheckoutLink
                  href={yearlyOption.href}
                  plan="yearly"
                  campaignSource="upgrade"
                  campaign="premium_yearly"
                  aria-label="Unlock Premium Yearly"
                  className="inline-flex items-center justify-center rounded-xl bg-bull px-8 py-4 font-syne text-sm font-extrabold uppercase tracking-[0.12em] text-[#0a1102] transition-all duration-200 hover:scale-105 hover:shadow-[0_0_30px_rgba(163,230,53,0.3)]"
                >
                  Unlock Premium →
                </CheckoutLink>
              )}
              <p className="font-mono text-[10px] text-white/30">Cancel anytime · instant access</p>
            </div>
          </div>
        </div>
      )}

      {/* Secondary cards row */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Monthly card */}
        {monthlyOption && (
          <div className="relative flex flex-col rounded-2xl border border-white/10 bg-[#080a10]/80 p-6 text-left backdrop-blur-md transition-all duration-300 hover:border-white/20">
            <p className="font-syne text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">Monthly</p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="font-anton text-4xl leading-none text-white">{usd(MEMBERSHIP_PRICING.monthly)}</p>
              <span className="text-sm text-white/30">/mo</span>
            </div>
            <p className="mt-2 text-xs text-white/40">Billed monthly · stand down anytime</p>

            <p className="mt-4 text-[13px] leading-relaxed text-white/50">
              Full premium access with the flexibility of month-to-month billing. Same tools, same edge.
            </p>

            <ul className="mt-4 space-y-2">
              {PREMIUM_FEATURES.slice(0, 4).map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-white/50">
                  <span className="mt-0.5 text-bull/60">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {hasPremium ? (
              <span className="mt-6 inline-flex w-full items-center justify-center rounded-xl border-2 border-bull/50 bg-bull/10 py-3 font-syne text-xs font-extrabold uppercase tracking-[0.1em] text-bull">
                Current Plan
              </span>
            ) : (
              <CheckoutLink
                href={monthlyOption.href}
                plan="monthly"
                campaignSource="upgrade"
                campaign="premium_monthly"
                aria-label="Unlock Premium Monthly"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl border-2 border-white/15 py-3 font-syne text-xs font-extrabold uppercase tracking-[0.1em] whitespace-nowrap text-white/70 transition-all duration-200 hover:border-bull/50 hover:bg-bull/5 hover:text-bull"
              >
                Unlock Monthly →
              </CheckoutLink>
            )}
          </div>
        )}

        {/* Community card */}
        {WHOP_COMMUNITY_CHECKOUT_OPTION && (
          <div className="relative flex flex-col rounded-2xl border border-sky-300/20 bg-[#080a10]/80 p-6 text-left backdrop-blur-md transition-all duration-300 hover:border-sky-300/40">
            <p className="font-syne text-[11px] font-bold uppercase tracking-[0.22em] text-sky-300/70">SPX Slayer</p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="font-anton text-4xl leading-none text-white">{usd(MEMBERSHIP_PRICING.community)}</p>
              <span className="text-sm text-white/30">/mo</span>
            </div>
            <p className="mt-2 text-xs text-sky-300/50">SPX desk access · billed monthly</p>

            <p className="mt-4 text-[13px] leading-relaxed text-white/50">
              The SPX desk only — GEX, dealer gamma, graded plays, and heatmaps. A focused edge at a focused price.
            </p>

            <ul className="mt-4 space-y-2">
              {COMMUNITY_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-white/50">
                  <span className="mt-0.5 text-sky-300/60">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {hasCommunity ? (
              <span className="mt-6 inline-flex w-full items-center justify-center rounded-xl border-2 border-sky-300/50 bg-sky-300/10 py-3 font-syne text-xs font-extrabold uppercase tracking-[0.1em] text-sky-300">
                Current Plan
              </span>
            ) : (
              <CheckoutLink
                href={WHOP_COMMUNITY_CHECKOUT_OPTION.href}
                plan="community"
                campaignSource="upgrade"
                campaign="spx_slayer"
                aria-label="Get SPX Slayer access"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl border-2 border-sky-300/20 py-3 font-syne text-xs font-extrabold uppercase tracking-[0.1em] whitespace-nowrap text-sky-300/70 transition-all duration-200 hover:border-sky-300/50 hover:bg-sky-300/5 hover:text-sky-300"
              >
                Get SPX Access →
              </CheckoutLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
