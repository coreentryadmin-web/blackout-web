import Link from "next/link";
import { IMAGES } from "@/lib/images";
import { StaticHeroWaveform } from "./StaticHeroWaveform";
import { StaticHeroProductStage } from "./StaticHeroProductStage";

const HERO_HOOK = "Serious traders don't wait for the tape.";
const HERO_LEDE = "Neither does BlackOut Intelligence.";

const CRED_MARKS = [
  "Real-time dealer positioning",
  "Institutional-grade feeds",
  "One command surface",
] as const;

/** Centered emblem hero — logo → headline → lede → CTA → creds; tagline anchors the floor. */
export function StaticLandingHero() {
  return (
    <section className="mkt-section mkt-hero mkt-hero-centered border-b-0">
      <StaticHeroWaveform />
      <div className="mkt-hero-centered-stack">
        <div className="mkt-hero-centered-inner mkt-section-inner mkt-reveal">
          <div className="mkt-hero-emblem-wrap">
            <div className="mkt-hero-emblem-glow" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element -- marketing static shell */}
            <img
              src={IMAGES.brandEmblem}
              alt=""
              className="mkt-hero-emblem"
              width={280}
              height={280}
              fetchPriority="high"
              decoding="async"
            />
          </div>

          <p className="mkt-kicker mkt-kicker-center">
            <span className="mkt-kicker-dot" aria-hidden />
            Institutional options desk
          </p>

          <h1 className="mkt-headline mkt-headline-centered">
            <span className="block mkt-headline-line">Trade like the</span>
            <span className="block mkt-headline-glow">lights are on.</span>
          </h1>

          <p className="mkt-lede mkt-lede-centered">
            Options flow, dealer positioning, live gamma structure, and the Night
            Hawk swing scanner — one command surface for the floor.
          </p>

          <div className="mkt-cta-row mkt-cta-row-centered">
            <Link
              href="/sign-in?redirect_url=%2Fdashboard"
              prefetch={false}
              className="landing-btn-primary mkt-cta-primary inline-flex min-w-[220px] items-center justify-center px-10 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em]"
            >
              Sign in
            </Link>
            <Link
              href="/pricing"
              prefetch={false}
              className="landing-btn-ghost mkt-cta-secondary hide-in-ios-app inline-flex min-w-[220px] items-center justify-center border border-white/25 px-10 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em] text-white"
            >
              See pricing
            </Link>
          </div>

          <ul className="mkt-cred-strip mkt-cred-strip-centered">
            {CRED_MARKS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <StaticHeroProductStage />
        </div>

        <p className="mkt-hero-floor-tagline" aria-label="Brand tagline">
          <span className="mkt-hero-floor-hook">{HERO_HOOK}</span>
          <span className="mkt-hero-floor-sub">{HERO_LEDE}</span>
        </p>
      </div>
    </section>
  );
}
