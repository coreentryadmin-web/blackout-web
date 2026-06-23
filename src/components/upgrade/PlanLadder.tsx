import {
  WHOP_CHECKOUT,
  WHOP_PREMIUM_CHECKOUT_OPTIONS,
  WHOP_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "@/lib/whop-checkout";
import { valuePropFor } from "@/lib/upsell-features";

// Presentational only. Renders the EXISTING Whop checkout options as a
// value-framed ladder. Hrefs are unchanged (already wired to Whop). No billing
// logic, no new tiers. Fallbacks match the prior upgrade-page behavior exactly.
export function PlanLadder() {
  if (WHOP_PREMIUM_CHECKOUT_OPTIONS.length === 0) {
    return WHOP_CHECKOUT.store ? (
      <a
        href={WHOP_CHECKOUT.store}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary"
      >
        View plans on Whop →
      </a>
    ) : (
      <p className="text-bear text-sm">{WHOP_CHECKOUT_UNAVAILABLE_MESSAGE}</p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {WHOP_PREMIUM_CHECKOUT_OPTIONS.map((option) => {
        const vp = valuePropFor(option.label);
        return (
          <div
            key={option.label}
            className={
              "relative flex flex-col p-5 border-2 text-left " +
              (vp.featured
                ? "border-bull shadow-glow-bull"
                : "border-purple/30")
            }
          >
            {vp.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-bull text-black font-mono text-[9px] tracking-[0.25em] uppercase px-3 py-1 font-bold whitespace-nowrap">
                {vp.badge}
              </span>
            )}
            <p className="font-syne text-white text-base font-extrabold leading-tight">
              {option.label}
            </p>
            {vp.subline && (
              <p className="text-sky-300 text-xs mt-1">{vp.subline}</p>
            )}
            {vp.savings && (
              <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-bull mt-2">
                {vp.savings}
              </p>
            )}
            <a
              href={option.href}
              target="_blank"
              rel="noopener noreferrer"
              className={
                "mt-5 inline-flex items-center justify-center w-full py-3 font-syne text-xs tracking-[0.2em] uppercase font-extrabold transition-all duration-200 " +
                (vp.featured
                  ? "bg-bull text-black hover:scale-105"
                  : "border-2 border-purple/50 text-purple-light hover:border-purple hover:text-white")
              }
            >
              Choose →
            </a>
          </div>
        );
      })}
    </div>
  );
}
