"use client";

import { motion } from "framer-motion";
import { LandingCta } from "@/components/landing/LandingCta";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";

const PREMIUM_FEATURES = [
  "HELIX live options-flow feed",
  "SPX Slayer · 0DTE desk",
  "Largo desk analyst",
  "Dealer gamma / GEX positioning",
  "Dark-pool prints",
  "Night Hawk evening playbook",
  "Strike-level heatmaps",
  "Transparent play log, graded A–F",
];

const COMMUNITY_FEATURES: { text: string; on: boolean }[] = [
  { text: "Private Discord server access", on: true },
  { text: "Daily live signals & market reads", on: true },
  { text: "Real-time session discussions", on: true },
  { text: "Evening recaps & next-day prep", on: true },
  { text: "Platform tools (Vector, Helix…)", on: false },
  { text: "AI desk analyst (Largo)", on: false },
];

function FeatureCheck({ on }: { on: boolean }) {
  return (
    <span
      className="grid place-items-center h-[18px] w-[18px] rounded-md shrink-0 font-mono text-[11px]"
      style={
        on
          ? { background: "rgba(0,230,118,0.14)", color: "#00e676", border: "1px solid rgba(0,230,118,0.3)" }
          : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)" }
      }
    >
      {on ? "✓" : "✕"}
    </span>
  );
}

function checkoutHref(url: string) {
  return url || WHOP_CHECKOUT.store || "/sign-up";
}

function isExternal(url: string) {
  return Boolean(url || WHOP_CHECKOUT.store);
}

export function PricingSection() {
  const communityHref = checkoutHref(WHOP_CHECKOUT.community);
  const monthlyHref = checkoutHref(WHOP_CHECKOUT.monthly);
  const yearlyHref = checkoutHref(WHOP_CHECKOUT.yearly);

  return (
    <section
      id="pricing"
      className="landing-section landing-section-cut relative py-28 md:py-32 px-4 md:px-8 overflow-hidden"
    >
      <PricingBackdrop />

      <div className="max-w-6xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center"
        >
          <p className="font-mono text-[10px] tracking-[0.5em] text-bull uppercase mb-3 flex items-center justify-center gap-2">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-bull" style={{ boxShadow: "0 0 10px #00e676" }} />
            Pricing
          </p>
          <h2 className="font-anton text-5xl md:text-[4.5rem] leading-[0.92] tracking-tight text-white">
            THE INSTITUTIONAL EDGE,
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #00e676, #34d399 55%, #7dd3fc)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              PRICED FOR RETAIL.
            </span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-white/65 max-w-2xl mx-auto">
            Community on Discord, or the full desk — monthly or yearly on Whop.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          {/* COMMUNITY */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="relative flex flex-col rounded-2xl p-7 md:p-8"
            style={{
              border: "1px solid rgba(125,211,252,0.25)",
              background: "linear-gradient(180deg, rgba(125,211,252,0.05), rgba(10,14,18,0.75))",
              backdropFilter: "blur(14px)",
            }}
          >
            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 mb-3">Community</p>
            <div className="flex items-end gap-2">
              <span className="font-anton text-5xl text-white leading-none">$75</span>
              <span className="font-mono text-[11px] text-secondary uppercase tracking-widest mb-1.5">/ month</span>
            </div>
            <p className="mt-4 text-[13px] text-sky-300/90 font-semibold">
              Discord access — live signals, daily reads, the room.
            </p>
            <ul className="flex flex-col gap-3 my-7 flex-1">
              {COMMUNITY_FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3 text-[13px]">
                  <FeatureCheck on={f.on} />
                  <span style={{ color: f.on ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}>
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>
            <LandingCta
              href={communityHref}
              external={isExternal(WHOP_CHECKOUT.community)}
              variant="outline"
              className="w-full text-center"
            >
              Join the community →
            </LandingCta>
            <p className="mt-3 text-center font-mono text-[10px] tracking-[0.12em] text-secondary uppercase">
              Upgrade to Premium anytime
            </p>
          </motion.div>

          {/* PREMIUM MONTHLY */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="relative flex flex-col rounded-2xl p-7 md:p-8 md:scale-[1.015]"
            style={{
              border: "1px solid rgba(0,230,118,0.45)",
              background: "linear-gradient(180deg, rgba(0,230,118,0.07), rgba(10,14,18,0.85))",
              backdropFilter: "blur(16px)",
              boxShadow: "0 30px 80px -36px rgba(0,230,118,0.55)",
            }}
          >
            <span
              aria-hidden
              className="absolute top-0 left-8 right-8 h-[2px] rounded-full"
              style={{ background: "linear-gradient(90deg, transparent, #00e676, transparent)", boxShadow: "0 0 18px #00e676" }}
            />
            <span
              className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] uppercase px-4 py-1.5 rounded-full font-bold"
              style={{ background: "linear-gradient(180deg,#00e676,#0f9d58)", color: "#021c14", boxShadow: "0 0 24px -6px rgba(0,230,118,0.7)" }}
            >
              Most popular
            </span>

            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-bull mb-3">Premium · Monthly</p>
            <div className="flex items-end gap-2">
              <span className="font-anton text-5xl md:text-6xl text-white leading-none">$199</span>
              <span className="font-mono text-[12px] text-secondary uppercase tracking-widest mb-2">/ month</span>
            </div>
            <p className="mt-2 font-mono text-[11px] text-secondary">Billed monthly · stand down anytime</p>
            <p className="mt-4 text-[13px] text-bull/90 font-semibold">Every instrument. One flat price. Discord included.</p>

            <ul className="grid grid-cols-1 gap-2.5 my-6 flex-1">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-[13px]">
                  <FeatureCheck on />
                  <span className="text-white/90">{f}</span>
                </li>
              ))}
            </ul>

            <LandingCta
              href={monthlyHref}
              external={isExternal(WHOP_CHECKOUT.monthly)}
              className="w-full text-center !px-0"
            >
              Start monthly →
            </LandingCta>
            <p className="mt-3 text-center font-mono text-[10px] tracking-[0.12em] text-secondary uppercase">
              Secure checkout · cancel anytime
            </p>
          </motion.div>

          {/* PREMIUM YEARLY */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative flex flex-col rounded-2xl p-7 md:p-8"
            style={{
              border: "1px solid rgba(125,211,252,0.25)",
              background: "linear-gradient(180deg, rgba(125,211,252,0.05), rgba(10,14,18,0.75))",
              backdropFilter: "blur(14px)",
            }}
          >
            <span
              className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] uppercase px-4 py-1.5 rounded-full font-bold"
              style={{ background: "rgba(125,211,252,0.18)", color: "#7dd3fc", border: "1px solid rgba(125,211,252,0.35)" }}
            >
              Best value
            </span>

            <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-sky-300 mb-3">Premium · Yearly</p>
            <div className="flex items-end gap-2">
              <span className="font-anton text-5xl text-white leading-none">$1,999</span>
              <span className="font-mono text-[11px] text-secondary uppercase tracking-widest mb-1.5">/ year</span>
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <span className="font-mono text-[11px] text-secondary">≈ $167/mo · billed yearly</span>
              <span
                className="font-mono text-[10px] rounded-md px-2 py-0.5"
                style={{ background: "rgba(0,230,118,0.14)", color: "#34d399", border: "1px solid rgba(0,230,118,0.28)" }}
              >
                Save $389 vs monthly
              </span>
            </div>
            <p className="mt-4 text-[13px] text-sky-300/90 font-semibold">Same full desk — pay once for the year.</p>

            <ul className="grid grid-cols-1 gap-2.5 my-6 flex-1">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-[13px]">
                  <FeatureCheck on />
                  <span className="text-white/90">{f}</span>
                </li>
              ))}
            </ul>

            <LandingCta
              href={yearlyHref}
              external={isExternal(WHOP_CHECKOUT.yearly)}
              variant="outline"
              className="w-full text-center"
            >
              Save $389 / yearly →
            </LandingCta>
            <p className="mt-3 text-center font-mono text-[10px] tracking-[0.12em] text-secondary uppercase">
              Discord included · cancel anytime
            </p>
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-10 text-center text-sm md:text-[15px] leading-relaxed font-medium text-white/85"
          style={{ textShadow: "0 2px 14px rgba(0,0,0,0.7)" }}
        >
          Sign up on BlackOut, then complete checkout with the same email — same login, instant access.{" "}
          <span className="text-bull font-bold">Educational tools, not financial advice. Every trade is your own decision.</span>
        </motion.p>
        <p
          className="mt-3 text-center text-[13px] md:text-sm font-medium text-white/75"
          style={{ textShadow: "0 2px 14px rgba(0,0,0,0.7)" }}
        >
          Billing or invoice questions?{" "}
          <a href="mailto:billing@blackouttrades.com" className="text-bull font-bold hover:underline">
            billing@blackouttrades.com
          </a>
        </p>
      </div>
    </section>
  );
}
