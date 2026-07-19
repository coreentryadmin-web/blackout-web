import type { CSSProperties } from "react";
import Link from "next/link";
import { MarketingProductScene } from "./MarketingProductScene";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";

/** Cinematic product reel — infinite marquee of live-rendered desk scenes. */
export function StaticProductFilmstrip() {
  const loop = [...MARKETING_PRODUCTS, ...MARKETING_PRODUCTS];

  return (
    <section id="tape" className="mkt-products-reel" aria-label="Platform products preview">
      <div className="mkt-section-inner mkt-products-reel-head">
        <p className="mkt-kicker mkt-kicker-center">
          <span className="mkt-kicker-dot" aria-hidden />
          Unified terminal
        </p>
        <h2 className="mkt-products-reel-title font-anton">
          MULTIPLE MODULES.
          <span className="mkt-gradient-text"> ONE EDGE.</span>
        </h2>
        <p className="mkt-products-reel-lede">
          Each module is purpose-built for a dimension of trading intelligence — flow, gamma, AI, and
          playbook — on one live-rendered desk surface.
        </p>
        <Link href="#features" prefetch={false} className="mkt-products-reel-cta font-syne">
          Explore every module ↓
        </Link>
      </div>

      <div className="mkt-products-marquee-wrap">
        <div className="mkt-products-marquee-fade mkt-products-marquee-fade--left" aria-hidden />
        <div className="mkt-products-marquee-fade mkt-products-marquee-fade--right" aria-hidden />
        <div className="mkt-products-marquee">
          <ul className="mkt-products-marquee-track">
            {loop.map((item, i) => (
              <li
                key={`${item.id}-${i}`}
                className="mkt-products-reel-card"
                style={{ "--mkt-accent": item.accent } as CSSProperties}
              >
                <Link
                  href={`#product-${item.id}`}
                  prefetch={false}
                  className="mkt-products-reel-card-link"
                  aria-label={`${item.label} — ${item.tag}`}
                >
                  <div className="mkt-products-reel-card-chrome">
                    <span className="mkt-products-reel-index font-mono">{String(item.index).padStart(2, "0")}</span>
                    <span className="mkt-products-reel-dot" style={{ background: item.accent }} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">{item.label}</span>
                    <span className="mkt-products-reel-audience font-mono">{item.audience}</span>
                    {item.launchStatus === "soon" && (
                      <span className="mkt-products-reel-soon font-mono">Soon</span>
                    )}
                  </div>
                  <div className="mkt-products-reel-card-body">
                    <div className="mkt-products-reel-scan" aria-hidden />
                    <MarketingProductScene productId={item.id} accent={item.accent} variant="card" />
                    <div className="mkt-products-reel-glow" aria-hidden />
                  </div>
                  <div className="mkt-products-reel-card-foot">
                    <span className="font-syne text-sm font-bold text-white">{item.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-sky-300">{item.tag}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
