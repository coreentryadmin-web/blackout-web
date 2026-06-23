"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { LandingCta } from "@/components/landing/LandingCta";
import { LandingBackdrop } from "@/components/landing/LandingBackdrop";
import { ProductMark } from "@/components/marks/ProductMark";

const HEAD_A = "READ THE TAPE.".split(" ");
const HEAD_B = "TRADE THE EDGE.".split(" ");

const wordV = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 16, delay: 0.2 + i * 0.12 },
  }),
};

// 4 orbit stations (deg around the ring) — radius via CSS clamp on the stage
const ORBIT = [
  { p: "helix" as const, deg: -90 },
  { p: "heatmap" as const, deg: 0 },
  { p: "nighthawk" as const, deg: 90 },
  { p: "largo" as const, deg: 180 },
];

const GRAD = "linear-gradient(90deg,#00e676,#34d399 55%,#7dd3fc)";

const CREDENTIALS = [
  "Institutional-grade data",
  "Real-time · tick-by-tick",
  "Trade on your own broker",
  "A terminal, not a Discord",
];

export function HeroSection() {
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const px = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });
  const py = useSpring(useMotionValue(0), { stiffness: 120, damping: 18 });

  const onMove = (e: React.MouseEvent) => {
    if (reduced || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width - 0.5) * 20); // ±10px
    py.set(((e.clientY - r.top) / r.height - 0.5) * 20);
  };
  const reset = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <section className="landing-section landing-section-hero relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-28 pb-20 px-4">
      <LandingBackdrop />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center gap-7">
        {/* KICKER */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="font-mono text-[10px] tracking-[0.4em] uppercase text-bull inline-flex items-center gap-2"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-bull animate-pulse motion-reduce:animate-none"
            style={{ boxShadow: "0 0 10px #00e676" }}
          />
          Institutional desk · 5 instruments
        </motion.p>

        {/* HEADLINE */}
        <h1 className="font-anton text-5xl md:text-7xl lg:text-8xl leading-[0.9] tracking-tight">
          <span className="block text-white">
            {HEAD_A.map((w, i) => (
              <motion.span
                key={w}
                custom={i}
                initial="hidden"
                animate="show"
                variants={wordV}
                className="inline-block mr-[0.25em]"
              >
                {w}
              </motion.span>
            ))}
          </span>
          <span className="block">
            {HEAD_B.map((w, i) => (
              <motion.span
                key={w}
                custom={i + HEAD_A.length}
                initial="hidden"
                animate="show"
                variants={wordV}
                className="inline-block mr-[0.25em]"
                style={{
                  background: GRAD,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {w}
              </motion.span>
            ))}
          </span>
        </h1>

        {/* SUBHEAD */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="max-w-2xl text-white/70 text-base md:text-lg leading-relaxed font-light"
        >
          The institutional data spine — live options flow, dealer gamma, an SPX 0DTE command desk,
          and an AI analyst — fused into one decision terminal. Not a Discord. Not a signal-seller.
        </motion.p>

        {/* CTAS */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-4 mt-1"
        >
          <LandingCta href="/sign-up" className="btn-cta-primary">
            Start Trading →
          </LandingCta>
          <LandingCta href="#features" variant="ghost">
            See the Arsenal
          </LandingCta>
        </motion.div>

        {/* SIGIL CONSTELLATION */}
        <div
          ref={stage}
          onMouseMove={onMove}
          onMouseLeave={reset}
          className="relative mt-6 grid place-items-center"
          style={{ width: "clamp(300px,42vw,460px)", height: "clamp(300px,42vw,460px)" }}
        >
          {/* slow-rotating orbit ring */}
          <span
            aria-hidden
            className="absolute rounded-full border border-dashed border-bull/20 motion-safe:animate-[spin_60s_linear_infinite]"
            style={{ width: "82%", height: "82%" }}
          />
          <motion.div className="absolute inset-0" style={{ x: px, y: py }}>
            {/* center SPX (large) */}
            <motion.span
              aria-hidden
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 120, damping: 16, delay: 0.45 }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <ProductMark product="spx" size={160} hero title="SPX Slayer" />
            </motion.span>
            {/* 4 orbit stations on glass chips */}
            {ORBIT.map((o, i) => (
              <motion.span
                key={o.p}
                aria-hidden
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.55 + i * 0.12 }}
                className="absolute left-1/2 top-1/2 grid place-items-center rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-2.5"
                style={{
                  transform: `translate(-50%,-50%) translate(${
                    Math.cos((o.deg * Math.PI) / 180) * 42
                  }%, ${Math.sin((o.deg * Math.PI) / 180) * 42}%)`,
                }}
              >
                <ProductMark product={o.p} size={64} hero />
              </motion.span>
            ))}
          </motion.div>
        </div>

        {/* CREDENTIAL ROW — honest, no numbers */}
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] tracking-[0.15em] uppercase text-sky-300/80 mt-2"
        >
          {CREDENTIALS.map((c, i) => (
            <li key={c} className="flex items-center gap-5">
              {i > 0 && <span aria-hidden className="hidden sm:inline h-3 w-px bg-bull/30" />}
              <span>{c}</span>
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
