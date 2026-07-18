import Link from "next/link";
import { IMAGES } from "@/lib/images";
import { StaticHeroWaveform } from "./StaticHeroWaveform";

const HERO_HOOK = "Serious traders don't wait for the tape.";
const HERO_LEDE = "Neither does BlackOut Intelligence.";

/** Centered emblem hero — logo → headline → CTA; tagline anchors the floor. */
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

          <div className="mkt-cta-row mkt-cta-row-centered">
            <Link
              href="/sign-up"
              prefetch={false}
              className="landing-btn-primary mkt-cta-primary inline-flex min-w-[220px] items-center justify-center px-10 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em]"
            >
              Get access
            </Link>
            <Link
              href="/pricing"
              prefetch={false}
              className="landing-btn-ghost mkt-cta-secondary hide-in-ios-app inline-flex min-w-[220px] items-center justify-center border border-white/25 px-10 py-3.5 font-syne text-sm font-bold uppercase tracking-[0.2em] text-white"
            >
              See pricing
            </Link>
          </div>
        </div>

        <p className="mkt-hero-floor-tagline" aria-label="Brand tagline">
          <span className="mkt-hero-floor-hook">{HERO_HOOK}</span>
          <span className="mkt-hero-floor-sub">{HERO_LEDE}</span>
        </p>
      </div>
    </section>
  );
}
