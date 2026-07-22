import {
  WHOP_CHECKOUT,
  WHOP_COMMUNITY_CHECKOUT_OPTION,
  WHOP_PREMIUM_CHECKOUT_OPTIONS,
  WHOP_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "@/lib/whop-checkout";
import { valuePropFor } from "@/lib/upsell-features";
import { BorderBeam } from "@/components/ui/motion/BorderBeam";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";

export function PlanLadder() {
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

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-3">
      {WHOP_COMMUNITY_CHECKOUT_OPTION && (
        <div className="relative flex flex-col rounded-2xl border border-sky-300/25 bg-[#080a10]/60 p-6 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-sky-300/50">
          <p className="font-syne text-[11px] font-bold uppercase tracking-[0.22em] text-sky-300">Community</p>
          <p className="mt-1 font-anton text-4xl leading-none text-white">{usd(MEMBERSHIP_PRICING.community)}</p>
          <p className="mt-2 text-xs text-sky-300">Discord access · billed monthly</p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/60">
            Live signals, daily reads, session discussions, evening recaps — the room.
          </p>
          <a
            href={WHOP_COMMUNITY_CHECKOUT_OPTION.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join the Community"
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl border-2 border-sky-300/25 py-3 font-syne text-xs font-extrabold uppercase tracking-[0.2em] text-sky-100 transition-all duration-200 hover:border-sky-300 hover:bg-sky-300/5 hover:text-sky-300"
          >
            Join Community →
          </a>
        </div>
      )}
      {WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => {
        const vp = valuePropFor(option.label);
        const [term, price] = option.label.split("—").map((s) => s.trim());
        return (
          <div
            key={option.label}
            className={
              "relative flex flex-col rounded-2xl border bg-[#080a10]/60 p-6 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 " +
              (vp.featured
                ? "upgrade-card-sheen border-bull/60 shadow-glow-bull md:scale-[1.02]"
                : "border-white/10 hover:border-bull/40")
            }
          >
            {/* Border beam marks the recommended plan — bull-green, matching /pricing. */}
            {vp.featured && <BorderBeam color="var(--sig-bull)" duration="6s" width="1.6px" />}
            {vp.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-bull px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-black">
                {vp.badge}
              </span>
            )}
            <p className="font-syne text-[11px] font-bold uppercase tracking-[0.22em] text-bull">{term}</p>
            <p className="mt-1 font-anton text-4xl leading-none text-white">{price}</p>
            {vp.subline && <p className="mt-2 text-xs text-sky-300">{vp.subline}</p>}
            {vp.savings && (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-bull">{vp.savings}</p>
            )}
            <a
              href={option.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Unlock Premium — ${option.label}`}
              className={
                "mt-6 inline-flex w-full items-center justify-center rounded-xl py-3 font-syne text-xs font-extrabold uppercase tracking-[0.2em] transition-all duration-200 " +
                (vp.featured
                  ? "bg-bull text-[#021108] hover:scale-105 hover:shadow-glow-bull"
                  : "border-2 border-white/15 text-sky-100 hover:border-bull hover:bg-bull/5 hover:text-bull")
              }
            >
              Unlock Premium →
            </a>
          </div>
        );
      })}
    </div>
  );
}
