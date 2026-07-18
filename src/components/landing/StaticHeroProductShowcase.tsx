import { IMAGES, MARKETING_MODULE_IMAGES } from "@/lib/images";

const FLOAT_CARDS = [
  { src: MARKETING_MODULE_IMAGES.helix, label: "HELIX", accent: "#22d3ee", className: "mkt-hero-float-helix" },
  { src: MARKETING_MODULE_IMAGES.thermal, label: "Thermal", accent: "#bf5fff", className: "mkt-hero-float-thermal" },
] as const;

/** Hero product visual — real desk screenshots in a chrome frame (no fake prices). */
export function StaticHeroProductShowcase() {
  return (
    <div className="mkt-hero-showcase mkt-reveal">
      <div className="mkt-hero-showcase-bg" style={{ backgroundImage: `url(${IMAGES.heroCommand})` }} aria-hidden />
      <div className="mkt-hero-showcase-glow" aria-hidden />

      <div className="mkt-hero-showcase-frame">
        <div className="mkt-hero-showcase-chrome">
          <span className="mkt-terminal-dot mkt-terminal-dot-red" />
          <span className="mkt-terminal-dot mkt-terminal-dot-amber" />
          <span className="mkt-terminal-dot mkt-terminal-dot-green" />
          <span className="mkt-hero-showcase-title">SPX Slayer · live desk</span>
          <span className="mkt-hero-showcase-badge">Product preview</span>
        </div>
        <div className="mkt-hero-showcase-screen">
          {/* eslint-disable-next-line @next/next/no-img-element -- marketing static shell */}
          <img
            src={MARKETING_MODULE_IMAGES.spx}
            alt="SPX Slayer — live 0DTE gamma matrix and dealer positioning desk"
            className="mkt-hero-showcase-shot"
            width={1280}
            height={720}
            fetchPriority="high"
            decoding="async"
          />
          <div className="mkt-hero-showcase-scan" aria-hidden />
          <div className="mkt-hero-showcase-vignette" aria-hidden />
        </div>
      </div>

      {FLOAT_CARDS.map((card) => (
        <div
          key={card.label}
          className={`mkt-hero-float-card ${card.className}`}
          style={{ borderColor: `${card.accent}55`, boxShadow: `0 20px 50px -20px ${card.accent}66` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.src} alt="" className="mkt-hero-float-shot" width={280} height={158} loading="lazy" decoding="async" />
          <span className="mkt-hero-float-label" style={{ color: card.accent }}>
            {card.label}
          </span>
        </div>
      ))}
    </div>
  );
}
