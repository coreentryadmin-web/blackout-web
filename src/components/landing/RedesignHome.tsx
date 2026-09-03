import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import { HOME_FAQ_IDS, selectFaqItems } from "@/lib/faq/content";
import { MARKETING_PRODUCTS, marketingModulesHeadline, marketingProductCount, premiumPricingPerks } from "@/lib/marketing/products";
import { MARKETING_DATA_FRESHNESS } from "@/lib/marketing/product-manifest";
import { IMAGES, MARKETING_MODULE_GALLERY } from "@/lib/images";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";
import type { PublicGexSnapshot } from "@/lib/public-gex-snapshot";
import { LandingRedesignFxLazy } from "./LandingRedesignFxLazy";
import { MarketingAuthAnchor, MarketingAuthCta, MarketingAuthLabel } from "./MarketingAuthCta";
import { HomeGammaHeroLink, HomeGammaPromo } from "./HomeGammaPromo";
import { HomeLiveDeskStrip } from "./HomeLiveDeskStrip";
import { HomeCommunityRail } from "./HomeCommunityRail";
import { MarketingHashLink } from "./MarketingHashLink";

/** Redesigned homepage body — server-rendered content + one client FX layer (canvas, reveal, ticker). */
export function RedesignHome({ initialGamma }: { initialGamma: PublicGexSnapshot }) {
  const productCount = marketingProductCount();
  const pricingPerks = premiumPricingPerks();
  const modulesHeadline = marketingModulesHeadline();

  return (
    <div className="rl">
      {/* ═══ Atmosphere layers ═══ */}
      <canvas id="atmos" aria-hidden="true" />
      <div className="atmos-grid" aria-hidden="true" />
      <div className="atmos-scan" aria-hidden="true" />
      <div className="atmos-sweep" aria-hidden="true" />
      <div className="spine" aria-hidden="true" />

      {/* ═══ §1 HERO — ENERGY REACTOR ═══ */}
      <section className="hero">
        {/* Energy reactor — canvas particle system */}
        <canvas id="energy-reactor-canvas" className="energy-canvas" aria-hidden="true" />

        <div id="hero-reactor" className="hero-reactor">
          <div className="logo-atmos" id="logo-atmos" />
          <div className="r-core">
            <Image
              className="logo-energy"
              src={IMAGES.brandEmblem}
              alt=""
              fill
              sizes="(max-width: 768px) 250px, 420px"
              aria-hidden
            />
            <Image
              className="logo-b"
              id="logo-img"
              src={IMAGES.brandEmblem}
              alt="BlackOut"
              fill
              sizes="(max-width: 768px) 250px, 420px"
              priority
            />
            <div className="logo-halo" />
            <canvas id="logo-breath" className="logo-breath" width={500} height={500} />
          </div>
          <canvas id="logo-edge-energy" className="logo-edge-energy" width={700} height={700} />
          <canvas id="filaments" className="filament-canvas" width={600} height={600} />
        </div>

        <div className="hero-h">
          <h1><span className="l1">Trade like</span><span className="l2">the lights</span><span className="on">are on.</span></h1>
        </div>

        <div className="hero-sub">
          <p><b>See what the dealers see.</b> Live positioning, flow, and graded setups — with quote age on every read.</p>
          <div className="cta-row">
            <MarketingAuthCta
              serverSignedIn={false}
              hrefSignedIn="/dashboard"
              hrefSignedOut="/sign-up"
              labelSignedIn="Open desk"
              labelSignedOut="Get access"
              className="btn-p"
            />
            <HomeGammaHeroLink />
          </div>
          <ul className="hero-creds">
            <li>{productCount} desk products</li>
            <li>12,400+ stocks screened daily</li>
            <li>Trade Grade A–F on every setup</li>
            <li>
              <Link href="/methodology" prefetch={false} className="hero-cred-link">
                Public track record
              </Link>
            </li>
            <li>
              <Link href="/tools/gamma-snapshot" prefetch={false} className="hero-cred-link">
                Free gamma snapshot
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <div className="node" aria-hidden="true" />

      <HomeLiveDeskStrip gamma={initialGamma} />

      <div className="node" aria-hidden="true" />

      <HomeGammaPromo initial={initialGamma} />

      <div className="node" aria-hidden="true" />

      {/* ═══ §2 COMMAND MODULES — APPLE KEYNOTE CAROUSEL ═══ */}
      <section className="sec-cmd" id="modules">
        {/* Atmospheric background layer */}
        <div className="cmd-atmos">
          <canvas id="cmd-bg" />
          <div className="cmd-glow" />
        </div>

        {/* Dominating headline */}
        <div className="cmd-header">
          <span className="kk"><span className="dot" />Every product, in depth</span>
          <h2>{modulesHeadline}<br /><span className="gt">One edge.</span></h2>
          <p className="cmd-sub">Each product is a full desk — purpose-built for one dimension of the tape, unified by BlackOut Intelligence. Full Desk includes every product — no per-product add-ons.</p>
        </div>

        {/* Carousel */}
        <div className="cmd-carousel-wrap">
          <div className="cmd-track" id="cmd-track">
            {MARKETING_PRODUCTS.map((m) => (
              <article key={m.id} className="cmd-card" style={{ "--ac": m.accent } as CSSProperties}>
                <div className="cmd-ring" aria-hidden="true">
                  <div className="cmd-ring-track" />
                </div>
                <div className="cmd-ring-glow" aria-hidden="true" />
                <div className="cmd-ring-bloom" aria-hidden="true" />
                <div className="cmd-chrome">
                  <div className="cmd-chrome-dots"><span /><span /><span /></div>
                  <span className="cmd-chrome-title">{m.label} &middot; live desk</span>
                </div>
                <div className="cmd-visual">
                  {MARKETING_MODULE_GALLERY[m.id].length > 1 ? (
                    <div className="cmd-gallery">
                      <div className="gal-track">
                        {MARKETING_MODULE_GALLERY[m.id].map((img, j) => (
                          <div key={j} className={`gal-slide${j === 0 ? " gal-active" : ""}`}>
                            <Image className="cmd-img" src={img} alt={`${m.label} screenshot ${j + 1}`} fill sizes="(max-width: 480px) 300px, (max-width: 768px) 360px, 520px" loading="lazy" />
                          </div>
                        ))}
                      </div>
                      <button className="gal-arrow gal-prev" aria-label="Previous">&#8249;</button>
                      <button className="gal-arrow gal-next" aria-label="Next">&#8250;</button>
                      <div className="gal-dots">
                        {MARKETING_MODULE_GALLERY[m.id].map((_, j) => (
                          <span key={j} className={`gal-dot${j === 0 ? " gal-dot-active" : ""}`} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Image className="cmd-img" src={MARKETING_MODULE_GALLERY[m.id][0]} alt={`${m.label} screenshot`} fill sizes="(max-width: 480px) 300px, (max-width: 768px) 360px, 520px" loading="lazy" />
                  )}
                  <div className="cmd-scan" aria-hidden="true" />
                </div>
                <div className="cmd-body">
                  <div className="cmd-top">
                    <span className="cmd-num">{String(m.index).padStart(2, "0")}</span>
                    <span className="cmd-tag">{m.tag}</span>
                    <span className="cmd-aud">{m.audience}</span>
                    {m.launchStatus === "soon" && (
                      <span className="cmd-aud" style={{ color: m.accent, background: `${m.accent}1a` }}>Soon</span>
                    )}
                  </div>
                  <div className="cmd-name">{m.label}</div>
                  <div className="cmd-hl">{m.headline}</div>
                  <div className="cmd-lede">{m.lede}</div>
                  <ul className="cmd-bullets">
                    {m.bullets.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                  <div className="cmd-foot">
                    <div className="cmd-stat">
                      <span className="cmd-stat-v">{m.stat.k}</span>
                      <span className="cmd-stat-k">{m.stat.v}</span>
                    </div>
                    <div className="cmd-actions">
                      {m.learnHref !== m.href && (
                        <Link href={m.learnHref} prefetch={false} className="cmd-learn">
                          Read the guide
                        </Link>
                      )}
                      <Link href={m.href} prefetch={false} className="cmd-cta">
                        {m.launchStatus === "soon" ? "Get early access" : `Open ${m.label}`}
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Navigation */}
          <div className="cmd-nav">
            <button className="cmd-arrow" id="cmd-prev" aria-label="Previous">&#8249;</button>
            <div className="cmd-dots" id="cmd-dots">
              {MARKETING_PRODUCTS.map((_, i) => (
                <span key={i} className={`cmd-dot${i === 0 ? " active" : ""}`} />
              ))}
            </div>
            <button className="cmd-arrow" id="cmd-next" aria-label="Next">&#8250;</button>
          </div>
        </div>
      </section>

      <div className="node" aria-hidden="true" />

      {/* ═══ §3 INTELLIGENCE PIPELINE ═══ */}
      <section className="sec-pipeline" id="protocol">
        <div className="w">
          <div className="pipe-head">
            <span className="kk"><span className="dot" />The intelligence engine</span>
            <h2>How BlackOut<br /><span className="gt">thinks.</span></h2>
            <p>Every opportunity passes through four stages. What survives is what reaches your screen.</p>
          </div>

          <div className="pipe-track">
            {/* Ingress — RAW DATA */}
            <div className="pipe-ingress" data-pipe-stage="ingress">
              <div className="pipe-ingress-inner">
                <canvas id="cv-ingest" width={400} height={60} />
                <span className="pipe-ingress-label">12,400+ stocks screened daily</span>
              </div>
            </div>

            <div className="pipe-conduit" data-pipe-conduit="0" aria-hidden="true"><div className="conduit-fill" /></div>

            {/* Stage 1 — IDENTIFY */}
            <div className="pipe-stage pipe-s1" data-pipe-stage="identify">
              <div className="pipe-stage-chrome">
                <div className="pipe-num">01</div>
                <div className="pipe-status" data-status-id="identify"><span className="status-dot" />SCAN</div>
              </div>
              <div className="pipe-stage-body">
                <div className="pipe-stage-text">
                  <h3>Identify</h3>
                  <p className="pipe-hl">Map dealer positioning from live options flow.</p>
                  <p className="pipe-desc">Dealer gamma, dark-pool blocks, institutional sweeps, and GEX walls — every signal that moves SPX, surfaced as positioning shifts on the tape.</p>
                  <div className="pipe-chips">
                    <span className="pipe-chip live">SCANNING</span>
                    <span className="pipe-chip">GEX WALLS</span>
                    <span className="pipe-chip">DARK POOL</span>
                    <span className="pipe-chip">SWEEPS</span>
                    <span className="pipe-chip">DEALER FLOW</span>
                  </div>
                </div>
                <div className="pipe-stage-visual">
                  <canvas id="cv-pipe-identify" width={480} height={220} />
                </div>
              </div>
            </div>

            <div className="pipe-conduit" data-pipe-conduit="1" aria-hidden="true"><div className="conduit-fill" /></div>

            {/* Stage 2 — VALIDATE */}
            <div className="pipe-stage pipe-s2" data-pipe-stage="validate">
              <div className="pipe-stage-chrome">
                <div className="pipe-num">02</div>
                <div className="pipe-status" data-status-id="validate"><span className="status-dot" />VERIFY</div>
              </div>
              <div className="pipe-stage-body">
                <div className="pipe-stage-visual">
                  <canvas id="cv-pipe-validate" width={480} height={220} />
                </div>
                <div className="pipe-stage-text">
                  <h3>Validate</h3>
                  <p className="pipe-hl">Every setup gated. Every grade earned.</p>
                  <p className="pipe-desc">The BIE verification stack scores confluence, runs Cortex analysis, checks invalidation triggers, and assigns an A&ndash;F grade. No grade, no play.</p>
                  <div className="pipe-chips">
                    <span className="pipe-chip live">BIE ENGINE</span>
                    <span className="pipe-chip">A&ndash;F GRADE</span>
                    <span className="pipe-chip">CONFLUENCE</span>
                    <span className="pipe-chip">CORTEX</span>
                    <span className="pipe-chip">INVALIDATION</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pipe-conduit" data-pipe-conduit="2" aria-hidden="true"><div className="conduit-fill" /></div>

            {/* Stage 3 — EXECUTE */}
            <div className="pipe-stage pipe-s3" data-pipe-stage="execute">
              <div className="pipe-stage-chrome">
                <div className="pipe-num">03</div>
                <div className="pipe-status" data-status-id="execute"><span className="status-dot" />STRUCTURE</div>
              </div>
              <div className="pipe-stage-body">
                <div className="pipe-stage-text">
                  <h3>Execute</h3>
                  <p className="pipe-hl">Structure, strike, timing. You pull the trigger.</p>
                  <p className="pipe-desc">Night Hawk and SPX Slayer surface the play with entry, stop, and target. No order routing, no broker lock-in — pure intelligence delivered to your screen.</p>
                  <div className="pipe-chips">
                    <span className="pipe-chip live">READY</span>
                    <span className="pipe-chip">ENTRY</span>
                    <span className="pipe-chip">STOP</span>
                    <span className="pipe-chip">TARGET</span>
                    <span className="pipe-chip">R:R</span>
                  </div>
                </div>
                <div className="pipe-stage-visual">
                  <canvas id="cv-pipe-execute" width={480} height={220} />
                </div>
              </div>
            </div>

            <div className="pipe-conduit" data-pipe-conduit="3" aria-hidden="true"><div className="conduit-fill" /></div>

            {/* Stage 4 — RESULTS */}
            <div className="pipe-stage pipe-s4" data-pipe-stage="results">
              <div className="pipe-stage-chrome">
                <div className="pipe-num">04</div>
                <div className="pipe-status" data-status-id="results"><span className="status-dot" />LOGGED</div>
              </div>
              <div className="pipe-stage-body">
                <div className="pipe-stage-visual pipe-results-visual">
                  <canvas id="cv-pipe-results" width={480} height={200} />
                </div>
                <div className="pipe-stage-text">
                  <h3>Results</h3>
                  <p className="pipe-hl">Receipts. Not promises.</p>
                  <p className="pipe-desc">Every play logged, graded, and timestamped. Win or lose, the record is public. No cherry-picking, no deleted calls — the full ledger, always.</p>
                  <div className="pipe-chips">
                    <span className="pipe-chip live">LOGGED</span>
                    <span className="pipe-chip">GRADED A&ndash;F</span>
                    <span className="pipe-chip">TIMESTAMPED</span>
                    <Link href="/methodology" prefetch={false} className="pipe-chip pipe-chip-link">
                      PUBLIC RECORD
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* Pipeline summary — the thesis */}
            <div className="pipe-summary" data-pipe-stage="summary">
              <div className="pipe-summary-inner">
                <canvas id="cv-pipe-summary" width={120} height={120} />
                <div className="pipe-summary-text">
                  <span className="pipe-summary-stat">High selectivity</span>
                  <span className="pipe-summary-label">of scanned setups survive to your screen</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="node" aria-hidden="true" />

      {/* ═══ §4 ACADEMY — free learn content funnel ═══ */}
      <section className="sec-academy" id="academy">
        <div className="w">
          <div className="academy-head">
            <span className="kk"><span className="dot" />BlackOut Academy</span>
            <h2>Learn dealer gamma<br /><span className="gt">before you trade it.</span></h2>
            <p className="academy-sub">
              Free guides on GEX, 0DTE structure, and institutional flow — the same concepts the desk is built on.
            </p>
            <Link href="/learn" prefetch={false} className="btn-g academy-hub-link">
              Browse all guides →
            </Link>
            <Link href="/tools/gamma-snapshot" prefetch={false} className="btn-g academy-tool-link">
              Try the free gamma snapshot →
            </Link>
          </div>
          <div className="academy-grid">
            <HomeGammaPromo initial={initialGamma} variant="academy" />
            <Link href="/learn/dealer-gamma-options-flow-guide" prefetch={false} className="academy-card">
              <span className="academy-tag">Pillar</span>
              <h3>Dealer gamma &amp; options flow</h3>
              <p>The complete map — gamma flip, walls, GEX, and how dealers move SPX.</p>
            </Link>
            <Link href="/learn/what-is-gex" prefetch={false} className="academy-card">
              <span className="academy-tag">Core</span>
              <h3>What is GEX?</h3>
              <p>Aggregate gamma exposure across the chain — and why it pins or accelerates price.</p>
            </Link>
            <Link href="/learn/how-to-read-options-flow" prefetch={false} className="academy-card">
              <span className="academy-tag">Flow</span>
              <h3>How to read options flow</h3>
              <p>Separate institutional signal from hedging noise on the live tape.</p>
            </Link>
          </div>
        </div>
      </section>

      <div className="node" aria-hidden="true" />

      <HomeCommunityRail />

      <div className="node" aria-hidden="true" />

      {/* ═══ §4 WHY BLACKOUT — THEM VS US ═══ */}
      <section className="sec-edge" id="edge">
        <div className="w">
          <div className="edge-layout">
            <div className="edge-statement">
              <span className="kk"><span className="dot" />Why BlackOut</span>
              <h2>Built like a <span className="gt">trading desk.</span><br />Not a Discord server.</h2>
            </div>
            <div className="vs-grid">
              <div className="vs-col vs-them">
                <div className="vs-label">Everywhere else</div>
                <ul className="vs-list">
                  <li>Delayed snapshots, manual refresh</li>
                  <li>Cherry-picked alerts, no receipts</li>
                  <li>Scattered across 5 tabs and 3 Discords</li>
                  <li>Gut-feel callouts, no grading</li>
                  <li>Stale data repackaged as &ldquo;signals&rdquo;</li>
                  <li>Monthly PDF recaps</li>
                </ul>
              </div>
              <div className="vs-col vs-us">
                <div className="vs-label">BlackOut</div>
                <ul className="vs-list">
                  <li>{MARKETING_DATA_FRESHNESS.comparison}</li>
                  <li>Every setup graded A–F with a logged track record</li>
                  <li>{productCount} products, one unified Full Desk</li>
                  <li>AI verification engine gates every play</li>
                  <li>Institutional flow, GEX, dark pool — streamed live</li>
                  <li>Real-time P&amp;L marks, not end-of-day summaries</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="node" aria-hidden="true" />

      {/* ═══ §5 PRICING ═══ */}
      <section className="sec-price" id="pricing">
        <div className="w">
          <div className="price-head">
            <span className="kk"><span className="dot" />Access</span>
            <h2>One desk.<br /><span className="gt">Your price.</span></h2>
          </div>
          <div className="price-grid">
            {/* SPX Slayer */}
            <div className="pc">
              <div className="plan">SPX Slayer</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.community)}<small> / mo</small></div>
              <div className="sub">SPX structure + 0DTE desk access</div>
              <ul className="perks">
                <li>Live SPX regime &amp; GEX</li>
                <li>0DTE graded plays A–F</li>
                <li>Dealer gamma positioning</li>
                <li>Strike-level heatmaps</li>
              </ul>
              {WHOP_CHECKOUT.community ? (
                <a href={WHOP_CHECKOUT.community} className="btn-g">Get SPX access</a>
              ) : (
                <MarketingAuthAnchor
                  serverSignedIn={false}
                  hrefSignedIn="/upgrade"
                  hrefSignedOut="/sign-up?redirect_url=%2Fupgrade"
                  className="btn-g"
                >
                  Get SPX access
                </MarketingAuthAnchor>
              )}
              <p className="trust">Cancel anytime &middot; No contracts</p>
            </div>

            {/* Premium (featured) */}
            <div className="pc feat">
              <span className="badge">FULL DESK</span>
              <div className="plan" style={{ color: "var(--g)" }}>Premium</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.monthly)}<small> / mo</small></div>
              <div className="sub">Every product — one membership</div>
              <ul className="perks">
                {pricingPerks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
                <li>Trade Grade A–F play log</li>
              </ul>
              {WHOP_CHECKOUT.monthly ? (
                <a href={WHOP_CHECKOUT.monthly} className="btn-p">Get full access <span className="cta-arrow">&rarr;</span></a>
              ) : (
                <MarketingAuthAnchor
                  serverSignedIn={false}
                  hrefSignedIn="/upgrade"
                  hrefSignedOut="/sign-up?redirect_url=%2Fupgrade"
                  className="btn-p"
                >
                  Get full access <span className="cta-arrow">&rarr;</span>
                </MarketingAuthAnchor>
              )}
              <p className="trust">Cancel anytime &middot; No contracts</p>
            </div>

            {/* Premium Yearly — "smart choice" */}
            <div className="pc yearly">
              <span className="yearly-save">Save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)}</span>
              <div className="plan">Premium &middot; Yearly</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.yearly)}<small> / yr</small></div>
              <div className="sub">{usd(MEMBERSHIP_PRICING.yearlyEffectiveMonthly)}/mo &middot; save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)} vs monthly</div>
              <ul className="perks">
                {pricingPerks.map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
                <li>Trade Grade A–F play log</li>
              </ul>
              {WHOP_CHECKOUT.yearly ? (
                <a href={WHOP_CHECKOUT.yearly} className="btn-p">Lock in yearly <span className="cta-arrow">&rarr;</span></a>
              ) : (
                <MarketingAuthAnchor
                  serverSignedIn={false}
                  hrefSignedIn="/upgrade"
                  hrefSignedOut="/sign-up?redirect_url=%2Fupgrade"
                  className="btn-p"
                >
                  Lock in yearly <span className="cta-arrow">&rarr;</span>
                </MarketingAuthAnchor>
              )}
              <p className="trust">Annual plan: 7-day money-back guarantee &middot; cancel anytime</p>
              <Link href="/refund-policy" prefetch={false} className="hero-cred-link">Refund policy &rarr;</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FAQ — INLINE ACCORDION ═══ */}
      <section className="sec-faq" id="faq">
        <div className="w">
          <div className="faq-head">
            <span className="kk"><span className="dot" />FAQ</span>
            <h2>Questions?<br /><span className="gt">Answered.</span></h2>
          </div>
          <div className="faq-list">
            {selectFaqItems(HOME_FAQ_IDS).map((item) => (
              <details className="faq-item" key={item.id}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ §6 CINEMATIC ENDING ═══ */}
      <section className="footer">
        <Image
          src={IMAGES.brandEmblem}
          alt=""
          width={1254}
          height={1254}
          sizes="(max-width: 768px) 250px, 420px"
          className="footer-ghost"
          loading="lazy"
          aria-hidden
        />
        <div className="footer-content">
          <div className="footer-brand">BLACKOUT</div>
          <div className="footer-tagline">The intelligence layer behind modern trading.</div>
          <div className="footer-cta cta-row">
            <MarketingAuthCta
              serverSignedIn={false}
              hrefSignedIn="/upgrade"
              hrefSignedOut="/sign-up?redirect_url=%2Fupgrade"
              labelSignedIn="Open the desk"
              labelSignedOut="Open the desk"
              className="btn-p"
            >
              Open the desk <span className="cta-arrow">&rarr;</span>
            </MarketingAuthCta>
            <MarketingHashLink href="#modules" className="btn-g">Browse products</MarketingHashLink>
          </div>
        </div>
      </section>


      {/* ═══ MOBILE STICKY CTA ═══ */}
      <div className="mobile-sticky-cta" id="mobile-sticky-cta">
        <div className="sticky-text">
          <strong>
            <MarketingAuthLabel serverSignedIn={false} signedInLabel="Open desk" signedOutLabel="Get Full Desk" />
          </strong>
          {usd(MEMBERSHIP_PRICING.monthly)}/mo
        </div>
        <MarketingAuthCta
          serverSignedIn={false}
          hrefSignedIn="/upgrade"
          hrefSignedOut="/sign-up?redirect_url=%2Fupgrade"
          labelSignedIn="Start now →"
          labelSignedOut="Start now →"
          className="sticky-btn"
        />
      </div>

      <LandingRedesignFxLazy />
    </div>
  );
}
