import type { CSSProperties } from "react";
import Link from "next/link";
import { MarketingProductScene } from "./MarketingProductScene";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";

const DEFAULT_ID = MARKETING_PRODUCTS[0].id;

/** Skylit-style hero module switcher — CSS tabs + live-rendered desk preview (no static PNGs). */
export function StaticHeroProductStage() {
  return (
    <div className="mkt-hero-stage mkt-reveal" aria-label="Platform module preview">
      <p className="mkt-hero-stage-kicker font-mono">Inside the platform</p>

      <div className="mkt-hero-stage-tabs-wrap">
        {MARKETING_PRODUCTS.map((p) => (
          <input
            key={p.id}
            type="radio"
            name="mkt-hero-module"
            id={`mkt-hero-mod-${p.id}`}
            className="mkt-hero-stage-input"
            defaultChecked={p.id === DEFAULT_ID}
          />
        ))}

        <div className="mkt-hero-stage-tablist" role="tablist" aria-label="Desk modules">
          {MARKETING_PRODUCTS.map((p) => (
            <label
              key={p.id}
              htmlFor={`mkt-hero-mod-${p.id}`}
              className="mkt-hero-stage-tab"
              style={{ "--mkt-accent": p.accent } as CSSProperties}
            >
              <span className="mkt-hero-stage-tab-name font-syne">{p.label}</span>
              {p.launchStatus === "soon" ? (
                <span className="mkt-hero-stage-tab-badge mkt-hero-stage-tab-badge--soon font-mono">Soon</span>
              ) : (
                <span className="mkt-hero-stage-tab-badge mkt-hero-stage-tab-badge--live font-mono">Live</span>
              )}
            </label>
          ))}
        </div>

        <div className="mkt-hero-stage-panels">
          {MARKETING_PRODUCTS.map((p) => (
            <article
              key={p.id}
              className="mkt-hero-stage-panel"
              data-product={p.id}
              aria-labelledby={`mkt-hero-mod-${p.id}`}
            >
              <div className="mkt-hero-stage-panel-copy">
                <span className="mkt-hero-stage-audience font-mono">{p.audience}</span>
                <h2 className="mkt-hero-stage-title font-anton">{p.label}</h2>
                <p className="mkt-hero-stage-blurb">{p.heroBlurb}</p>
                <Link
                  href={p.href}
                  prefetch={false}
                  className="mkt-hero-stage-link font-syne hide-in-ios-app"
                >
                  {p.launchStatus === "soon" ? "Get access →" : `Open ${p.label} →`}
                </Link>
              </div>
              <div className="mkt-hero-stage-visual">
                <MarketingProductScene productId={p.id} accent={p.accent} variant="hero" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
