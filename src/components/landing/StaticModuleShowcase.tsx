import type { CSSProperties } from "react";
import Link from "next/link";
import { ModulePreviewMock } from "./ModulePreviewMock";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";

/** Full product catalog — alternating rows, anchor deep-links, CSS motion. */
export function StaticModuleShowcase() {
  return (
    <section id="features" className="mkt-section mkt-products-catalog">
      <div className="mkt-section-inner">
        <div className="mkt-products-catalog-intro mkt-reveal">
          <p className="mkt-kicker">
            <span className="mkt-kicker-dot" aria-hidden />
            Platform modules
          </p>
          <h2 className="mt-3 font-anton text-4xl leading-[0.92] text-white md:text-6xl">
            BUILT FOR THE
            <br />
            <span className="mkt-gradient-text">SERIOUS FLOOR.</span>
          </h2>
          <p className="mkt-lede !mx-0 !mt-4 !max-w-2xl !text-left !text-sm md:!text-base">
            Purpose-built modules — like the best terminals — unified by BlackOut Intelligence. Same
            verification gate, same live tape, no broker lock-in.
          </p>
        </div>

        <nav className="mkt-products-rail" aria-label="Jump to product">
          {MARKETING_PRODUCTS.map((p) => (
            <a
              key={p.id}
              href={`#product-${p.id}`}
              className="mkt-products-rail-pill"
              style={{ "--mkt-accent": p.accent } as CSSProperties}
            >
              <span className="mkt-products-rail-num font-mono">{String(p.index).padStart(2, "0")}</span>
              <span className="font-syne text-xs font-bold">{p.label}</span>
            </a>
          ))}
        </nav>

        <div className="mkt-products-stack">
          {MARKETING_PRODUCTS.map((m, i) => {
            const reverse = i % 2 === 1;
            const ctaLabel =
              m.launchStatus === "soon" ? "Get early access →" : `Open ${m.label} →`;

            return (
              <article
                key={m.id}
                id={`product-${m.id}`}
                className={`mkt-product-row mkt-product-row--${m.id}${reverse ? " mkt-product-row--reverse" : ""}`}
                style={
                  {
                    "--mkt-accent": m.accent,
                    "--mkt-row-delay": `${0.08 + i * 0.07}s`,
                  } as CSSProperties
                }
              >
                <div className="mkt-product-row-grid">
                  <div className="mkt-product-copy">
                    <div className="mkt-product-copy-head">
                      <span className="mkt-product-index font-mono">{String(m.index).padStart(2, "0")}</span>
                      <span className="mkt-product-audience font-mono">{m.audience}</span>
                      <span className="mkt-product-tag font-mono">{m.tag}</span>
                      {m.launchStatus === "soon" && (
                        <span className="mkt-product-soon-badge font-mono">Launching soon</span>
                      )}
                    </div>
                    <h3 className="font-anton text-3xl leading-[0.95] text-white md:text-5xl">{m.label}</h3>
                    <p className="mkt-product-headline font-syne text-lg font-bold text-white/90 md:text-xl">
                      {m.headline}
                    </p>
                    <p className="mkt-product-lede">{m.lede}</p>
                    <ul className="mkt-module-bullets mkt-product-bullets">
                      {m.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <div className="mkt-module-foot mkt-product-foot">
                      <div className="mkt-module-stat" style={{ borderColor: `${m.accent}44` }}>
                        <span className="font-anton text-3xl" style={{ color: m.accent }}>
                          {m.stat.k}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-sky-300">
                          {m.stat.v}
                        </span>
                      </div>
                      <Link
                        href={m.href}
                        prefetch={false}
                        className="mkt-module-link mkt-product-cta font-syne text-sm font-bold uppercase tracking-[0.16em] text-bull no-underline"
                      >
                        {ctaLabel}
                      </Link>
                    </div>
                  </div>
                  <div className="mkt-product-visual">
                    <ModulePreviewMock moduleId={m.id} label={m.label} accent={m.accent} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
