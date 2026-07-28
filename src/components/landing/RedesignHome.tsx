import Link from "next/link";
import type { CSSProperties } from "react";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";
import { IMAGES, MARKETING_MODULE_GALLERY } from "@/lib/images";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { WHOP_CHECKOUT } from "@/lib/whop-checkout";
import { LandingRedesignFx } from "./LandingRedesignFx";

/** Redesigned homepage body — server-rendered content + one client FX layer (canvas, reveal, ticker). */
export function RedesignHome({ signedIn = false }: { signedIn?: boolean }) {
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo-energy" src={IMAGES.brandEmblem} alt="BlackOut" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo-b" id="logo-img" src={IMAGES.brandEmblem} alt="BlackOut" />
            <div className="logo-halo" />
            <canvas id="logo-breath" className="logo-breath" width={500} height={500} />
          </div>
          <canvas id="logo-edge-energy" className="logo-edge-energy" width={700} height={700} />
          <canvas id="filaments" className="filament-canvas" width={600} height={600} />
        </div>

        <div className="hero-h">
          <h1>Trade like<br />the lights<br /><span className="on">are on.</span></h1>
        </div>

        <div className="hero-sub">
          <p><b>See what the dealers see.</b> Trade before the crowd moves.</p>
          <div className="cta-row">
            <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-p">
              {signedIn ? "Open desk" : "Get access"}
            </Link>
            <Link href="#modules" prefetch={false} className="btn-g">Explore the desk</Link>
          </div>
          <ul className="hero-creds">
            <li>6 live engines</li>
            <li>12,400+ contracts scanned daily</li>
            <li>Every setup graded A–F</li>
          </ul>
        </div>
      </section>

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
          <span className="kk"><span className="dot" />Every module, in depth</span>
          <h2>Six engines.<br /><span className="gt">One edge.</span></h2>
          <p className="cmd-sub">Each module is a full product — purpose-built for one dimension of the tape, unified by BlackOut Intelligence. No add-ons, no upsells: the whole desk is one price.</p>
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
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img className="cmd-img" src={img} alt={`${m.label} screenshot ${j + 1}`} loading="lazy" />
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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="cmd-img" src={MARKETING_MODULE_GALLERY[m.id][0]} alt={`${m.label} screenshot`} loading="lazy" />
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
                    <Link href={m.href} prefetch={false} className="cmd-cta">
                      {m.launchStatus === "soon" ? "Get early access" : `Open ${m.label}`}
                    </Link>
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

      {/* ═══ §3 PROTOCOL — STAGGERED, OVERSIZED NUMBERS ═══ */}
      <section className="sec-proto" id="protocol">
        <div className="w">
          <div className="proto-head">
            <span className="kk"><span className="dot" />The protocol</span>
            <h2>Identify. Validate.<br /><span className="gt">Execute.</span></h2>
            <p>Three stages. Every trade passes through all of them — or it doesn&apos;t reach your screen.</p>
          </div>
          <div className="proto-row">
            {/* Card 1: IDENTIFY */}
            <div className="proto-card" style={{ "--sc": "#a3e635" } as CSSProperties}>
              <span className="num">01</span>
              <div className="pf-header">
                <div className="pf-icon">&#9678;</div>
                <div><span className="tag">IDENTIFY</span><h3>Read the Floor</h3></div>
              </div>
              <p className="pf-body">Live dealer gamma, dark-pool prints, institutional sweeps — every signal that moves SPX, surfaced before the tape catches up.</p>
              <div className="pf-visual"><canvas id="cv-identify" width={600} height={260} /></div>
              <div className="pf-metrics">
                <span className="pf-chip live">SCANNING</span>
                <span className="pf-chip">GEX WALLS</span>
                <span className="pf-chip">DARK POOL</span>
                <span className="pf-chip">SWEEPS</span>
              </div>
            </div>

            {/* Card 2: VALIDATE */}
            <div className="proto-card" style={{ "--sc": "#22d3ee" } as CSSProperties}>
              <span className="num">02</span>
              <div className="pf-header">
                <div className="pf-icon">&#10003;</div>
                <div><span className="tag">VALIDATE</span><h3>Every Setup Graded</h3></div>
              </div>
              <p className="pf-body">Gated by the BIE verification stack — confluence scoring, cortex analysis, invalidation triggers, and a graded A&ndash;F log with receipts.</p>
              <div className="pf-visual"><canvas id="cv-validate" width={600} height={260} /></div>
              <div className="pf-metrics">
                <span className="pf-chip live">VERIFIED</span>
                <span className="pf-chip">A&ndash;F GRADE</span>
                <span className="pf-chip">CONFLUENCE</span>
                <span className="pf-chip">CORTEX</span>
              </div>
            </div>

            {/* Card 3: EXECUTE */}
            <div className="proto-card" style={{ "--sc": "#bf5fff" } as CSSProperties}>
              <span className="num">03</span>
              <div className="pf-header">
                <div className="pf-icon">&#9654;</div>
                <div><span className="tag">EXECUTE</span><h3>Your Trigger</h3></div>
              </div>
              <p className="pf-body">Pure intelligence — no order routing, no broker lock-in. We surface the structure, the strike, and the timing. You pull the trigger.</p>
              <div className="pf-visual"><canvas id="cv-execute" width={600} height={260} /></div>
              <div className="pf-metrics">
                <span className="pf-chip live">READY</span>
                <span className="pf-chip">ENTRY</span>
                <span className="pf-chip">STOP</span>
                <span className="pf-chip">TARGET</span>
              </div>
            </div>
          </div>
        </div>
        <div className="diag-cut" aria-hidden="true" />
      </section>

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
                  <li>Live tick-by-tick — zero delay</li>
                  <li>Every setup graded A–F with a logged track record</li>
                  <li>6 engines, one screen, one membership</li>
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
              <a href={WHOP_CHECKOUT.community || (signedIn ? "/upgrade" : "/sign-up?redirect_url=%2Fupgrade")} className="btn-g">Get SPX access</a>
              <p className="trust">Cancel anytime &middot; No contracts</p>
            </div>

            {/* Premium (featured) */}
            <div className="pc feat">
              <span className="badge">FULL DESK</span>
              <div className="plan" style={{ color: "var(--g)" }}>Premium</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.monthly)}<small> / mo</small></div>
              <div className="sub">Every module + Discord — one membership</div>
              <ul className="perks">
                <li>HELIX live options-flow</li>
                <li>SPX Slayer 0DTE desk</li>
                <li>Largo AI analyst</li>
                <li>Dealer gamma / GEX</li>
                <li>Dark-pool prints</li>
                <li>Night Hawk scanner</li>
                <li>Strike-level heatmaps</li>
                <li>Graded play log A-F</li>
              </ul>
              <a href={WHOP_CHECKOUT.monthly || (signedIn ? "/upgrade" : "/sign-up?redirect_url=%2Fupgrade")} className="btn-p">Get full access &rarr;</a>
              <p className="trust">Cancel anytime &middot; No contracts</p>
            </div>

            {/* Premium Yearly — "smart choice" */}
            <div className="pc yearly">
              <span className="yearly-save">Save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)}</span>
              <div className="plan">Premium &middot; Yearly</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.yearly)}<small> / yr</small></div>
              <div className="sub">{usd(MEMBERSHIP_PRICING.yearlyEffectiveMonthly)}/mo &middot; save {usd(MEMBERSHIP_PRICING.yearlySavingsVsMonthly)} vs monthly</div>
              <ul className="perks">
                <li>HELIX live options-flow</li>
                <li>SPX Slayer 0DTE desk</li>
                <li>Largo AI analyst</li>
                <li>Dealer gamma / GEX</li>
                <li>Dark-pool prints</li>
                <li>Night Hawk scanner</li>
                <li>Strike-level heatmaps</li>
                <li>Graded play log A-F</li>
              </ul>
              <a href={WHOP_CHECKOUT.yearly || (signedIn ? "/upgrade" : "/sign-up?redirect_url=%2Fupgrade")} className="btn-p">Lock in yearly &rarr;</a>
              <p className="trust">Cancel anytime &middot; No contracts</p>
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
            <details className="faq-item">
              <summary>Can I cancel anytime?</summary>
              <p>Yes. Billing is handled through our secure checkout partner, and you can manage or cancel your membership anytime from your account.</p>
            </details>
            <details className="faq-item">
              <summary>Do I need to connect a broker?</summary>
              <p>No. BlackOut is a pure intelligence layer &mdash; you execute on your own broker. We surface the data, structure, and setups; you pull the trigger wherever you already trade.</p>
            </details>
            <details className="faq-item">
              <summary>What&apos;s the difference between SPX Slayer and Premium?</summary>
              <p>SPX Slayer ({usd(MEMBERSHIP_PRICING.community)}/mo) gives you the 0DTE desk &mdash; live SPX regime, GEX, and graded plays. Premium ({usd(MEMBERSHIP_PRICING.monthly)}/mo or {usd(MEMBERSHIP_PRICING.yearly)}/yr) unlocks all six modules: HELIX flow, Largo analyst, dark pool, Night Hawk, heatmaps, and the full graded play log.</p>
            </details>
            <details className="faq-item">
              <summary>Is any of this financial advice?</summary>
              <p>No. BlackOut provides market data, analytics, and pattern-recognition tools for educational and informational purposes only. Every trade is your own decision.</p>
            </details>
            <details className="faq-item">
              <summary>How do I get started?</summary>
              <p>Create your account, pick a plan, and the live desk is there immediately. Inside your first session you&apos;ll have the full read in front of you.</p>
            </details>
          </div>
        </div>
      </section>

      {/* ═══ §6 CINEMATIC ENDING ═══ */}
      <section className="footer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={IMAGES.brandEmblem} alt="" className="footer-ghost" />
        <div className="footer-content">
          <div className="footer-brand">BLACKOUT</div>
          <div className="footer-tagline">The intelligence layer behind modern trading.</div>
          <div className="footer-cta cta-row">
            <Link href={signedIn ? "/upgrade" : "/sign-up?redirect_url=%2Fupgrade"} prefetch={false} className="btn-p">Stop trading blind</Link>
            <Link href="#modules" prefetch={false} className="btn-g">See the desk</Link>
          </div>
          <nav className="footer-links">
            <a href="#faq">FAQ</a>
            <Link href="/terms" prefetch={false}>Terms</Link>
            <Link href="/privacy" prefetch={false}>Privacy</Link>
            <a href={SITE.social.discord.url} target="_blank" rel="noopener noreferrer">Discord</a>
            <a href={SITE.social.x.url} target="_blank" rel="noopener noreferrer">X</a>
            <a href={SITE.social.instagram.url} target="_blank" rel="noopener noreferrer">Instagram</a>
          </nav>
          <p className="footer-copy">&copy; 2026 {SITE.legalName}. All rights reserved.</p>
        </div>
      </section>


      {/* ═══ MOBILE STICKY CTA ═══ */}
      <div className="mobile-sticky-cta" id="mobile-sticky-cta">
        <div className="sticky-text">
          <strong>{signedIn ? "Open desk" : "Get access"}</strong>
          From {usd(MEMBERSHIP_PRICING.monthly)}/mo
        </div>
        <Link href={signedIn ? "/upgrade" : "/sign-up?redirect_url=%2Fupgrade"} prefetch={false} className="sticky-btn">
          Start now &rarr;
        </Link>
      </div>

      <LandingRedesignFx />
    </div>
  );
}
