import Link from "next/link";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

const PREMIUM = [
  "HELIX live options-flow feed",
  "SPX Slayer · 0DTE desk",
  "Largo desk analyst",
  "Dealer gamma / GEX positioning",
  "Dark-pool prints",
  "Night Hawk evening playbook",
  "Strike-level heatmaps",
  "Transparent play log, graded A–F",
];

const COMMUNITY = [
  "Private Discord server access",
  "Daily live signals & market reads",
  "Real-time session discussions",
  "Evening recaps & next-day prep",
];

/** Static pricing — no framer-motion; all 3 paid tiers visible (no toggle JS). */
export function StaticPricingSection() {
  const monthlyHref = WHOP_CHECKOUT.monthly || WHOP_CHECKOUT.store || "/sign-up";
  const yearlyHref = WHOP_CHECKOUT.yearly || WHOP_CHECKOUT.store || "/sign-up";
  const communityHref = WHOP_CHECKOUT.community || WHOP_CHECKOUT.store || "/sign-up";

  const external = (href: string) =>
    href.startsWith("http") ? { target: "_blank" as const, rel: "noopener noreferrer" } : {};

  return (
    <section id="pricing" className="mkt-section border-b-0">
      <div className="mkt-section-inner max-w-6xl">
        <p className="mkt-kicker justify-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Pricing
        </p>
        <h2 className="mt-3 text-center font-anton text-4xl leading-[0.92] text-white md:text-[4rem]">
          THE INSTITUTIONAL EDGE,
          <br />
          <span className="mkt-gradient-text">PRICED FOR RETAIL.</span>
        </h2>
        <p className="mkt-lede text-center">
          Community on Discord, or the full desk — monthly or yearly on Whop.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {/* COMMUNITY */}
          <div className="mkt-card flex flex-col" style={{ borderColor: "rgba(125,211,252,0.25)" }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-sky-300">Community</p>
            <p className="mt-4 font-anton text-5xl text-white">
              $75<span className="font-syne text-lg font-semibold text-sky-300"> / month</span>
            </p>
            <p className="mt-2 text-sm text-sky-300">Discord access — live signals, daily reads, the room</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-white/85">
              {COMMUNITY.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-sky-300">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={communityHref}
              prefetch={false}
              className="landing-btn-ghost mt-8 inline-flex items-center justify-center border border-sky-300/30 px-6 py-3 font-syne text-sm font-bold uppercase tracking-[0.18em] text-white"
              {...external(communityHref)}
            >
              Join the community
            </Link>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-sky-300/60">
              Upgrade to Premium anytime
            </p>
          </div>

          {/* PREMIUM MONTHLY */}
          <div className="mkt-card flex flex-col" style={{ borderColor: "rgba(0,230,118,0.35)" }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-bull">Premium · Monthly</p>
            <p className="mt-4 font-anton text-5xl text-white">
              $199<span className="font-syne text-lg font-semibold text-sky-300"> / month</span>
            </p>
            <p className="mt-2 text-sm text-sky-300">Full desk + Discord · billed monthly</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-white/85">
              {PREMIUM.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-bull">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={monthlyHref}
              prefetch={false}
              className="landing-btn-primary mt-8 inline-flex items-center justify-center px-6 py-3 font-syne text-sm font-bold uppercase tracking-[0.18em]"
              {...external(monthlyHref)}
            >
              Start monthly
            </Link>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              Cancel anytime
            </p>
          </div>

          {/* PREMIUM YEARLY */}
          <div className="mkt-card mkt-card-glow flex flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-bull">Premium · Yearly</p>
            <p className="mt-4 font-anton text-5xl text-white">
              $1,999<span className="font-syne text-lg font-semibold text-sky-300"> / year</span>
            </p>
            <p className="mt-2 text-sm text-sky-300">≈ $167/mo · Save $389 vs monthly</p>
            <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-white/85">
              {PREMIUM.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-bull">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={yearlyHref}
              prefetch={false}
              className="landing-btn-primary mt-8 inline-flex items-center justify-center px-6 py-3 font-syne text-sm font-bold uppercase tracking-[0.18em]"
              {...external(yearlyHref)}
            >
              Save $389 / yearly
            </Link>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              Discord included · cancel anytime
            </p>
          </div>
        </div>

        <p className="mt-10 text-center text-sm text-white/70">
          Need an account first?{" "}
          <Link href="/sign-up" prefetch={false} className="text-bull hover:underline">
            Sign up free
          </Link>{" "}
          — checkout on Whop uses the same email.
        </p>
      </div>
    </section>
  );
}
