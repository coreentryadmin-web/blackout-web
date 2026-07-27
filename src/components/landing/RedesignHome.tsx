import Link from "next/link";
import type { CSSProperties } from "react";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";
import { IMAGES, MARKETING_MODULE_GALLERY } from "@/lib/images";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";
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
          <div className="containment-ring" />
          <div className="containment-ring2" />
          <canvas id="filaments" className="filament-canvas" width={600} height={600} />
        </div>
        <div className="r-out" />
        <canvas id="hero-wm" className="hero-watermark" width={800} height={800} />

        <div className="hero-h">
          <h1>Trade like<br />the lights<br /><span className="on">are on.</span></h1>
        </div>

        <div className="hero-sub">
          <p><b>Institutional-grade intelligence</b> — live dealer flow, real-time gamma exposure, and a verification engine that grades every setup before you risk a dollar.</p>
          <div className="cta-row">
            <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-p">
              {signedIn ? "Open desk" : "Get access"}
            </Link>
            <Link href="#modules" prefetch={false} className="btn-g">Explore the desk</Link>
          </div>
          <ul className="hero-creds">
            <li>Live dealer flow</li>
            <li>Real-time GEX</li>
            <li>AI-graded setups</li>
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

        <canvas id="mod-wm" className="wm" width={600} height={600} />

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
        <canvas id="proto-wm" className="wm" width={500} height={500} />
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

      {/* ═══ §4 WHY BLACKOUT — EDITORIAL ═══ */}
      <section className="sec-edge" id="edge">
        <canvas id="edge-wm" className="wm" width={700} height={700} />
        <div className="w">
          <div className="edge-layout">
            <div className="edge-statement">
              <span className="kk"><span className="dot" />Why BlackOut</span>
              <h2>Built like a <span className="gt">trading desk.</span><br />Not a Discord server.</h2>
              <p>Professional-grade intelligence, institutional data, and real-time execution — in a single interface anyone can use.</p>
            </div>
            <div className="edge-facts">
              {/* Card 1: Institutional Market Data */}
              <div className="edge-fact" style={{ "--fc": "#a3e635" } as CSSProperties}>
                <div className="ef-header"><div className="ef-icon">&#9673;</div><h3>Institutional Market Data</h3></div>
                <p className="ef-body">The same institutional positioning, options flow, dealer exposure, and execution intelligence trusted by professional trading desks — streamed live, without delay.</p>
                <div className="ef-visual"><canvas id="cv-feeds" width={600} height={240} /></div>
                <div className="ef-metrics">
                  <span className="ef-chip live">LIVE FEED</span>
                  <span className="ef-chip">GEX/DEX</span>
                  <span className="ef-chip">OPTIONS FLOW</span>
                  <span className="ef-chip">DARK POOL</span>
                </div>
              </div>

              {/* Card 2: Live Before the Crowd */}
              <div className="edge-fact" style={{ "--fc": "#22d3ee" } as CSSProperties}>
                <div className="ef-header"><div className="ef-icon">&#9889;</div><h3>Live Before the Crowd</h3></div>
                <p className="ef-body">No refresh buttons. No stale snapshots. Every sweep, dealer shift, and flow event updates as it happens — tick by tick, in real time.</p>
                <div className="ef-visual"><canvas id="cv-latency" width={600} height={240} /></div>
                <div className="ef-metrics">
                  <span className="ef-chip live">0ms DELAY</span>
                  <span className="ef-chip">TICK-BY-TICK</span>
                  <span className="ef-chip">SSE STREAMS</span>
                  <span className="ef-chip">LIVE MARKS</span>
                </div>
              </div>

              {/* Card 3: Signal Over Noise */}
              <div className="edge-fact" style={{ "--fc": "#bf5fff" } as CSSProperties}>
                <div className="ef-header"><div className="ef-icon">&#10024;</div><h3>Signal Over Noise</h3></div>
                <p className="ef-body">Every opportunity is filtered through the BIE verification engine — turning millions of market events into only the trades that matter.</p>
                <div className="ef-visual"><canvas id="cv-intel" width={600} height={240} /></div>
                <div className="ef-metrics">
                  <span className="ef-chip live">AI VERIFIED</span>
                  <span className="ef-chip">CONFLUENCE</span>
                  <span className="ef-chip">CORTEX GATE</span>
                  <span className="ef-chip">GRADED A&ndash;F</span>
                </div>
              </div>

              {/* Card 4: Everything. One Interface. */}
              <div className="edge-fact" style={{ "--fc": "#ff6b2b" } as CSSProperties}>
                <div className="ef-header"><div className="ef-icon">&#9638;</div><h3>Everything. One Interface.</h3></div>
                <p className="ef-body">Dealer positioning, institutional flow, AI verification, thermal heatmaps, swing intelligence, and market-wide scanning — all connected inside a single workspace.</p>
                <div className="ef-visual"><canvas id="cv-surface" width={600} height={240} /></div>
                <div className="ef-metrics">
                  <span className="ef-chip live">6 MODULES</span>
                  <span className="ef-chip">UNIFIED</span>
                  <span className="ef-chip">ONE SCREEN</span>
                  <span className="ef-chip">ZERO NOISE</span>
                </div>
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
            <h2>One desk.<br /><span className="gt">One price.</span></h2>
          </div>
          <div className="price-grid">
            {/* Community */}
            <div className="pc">
              <div className="plan">Community</div>
              <div className="amt">{usd(MEMBERSHIP_PRICING.community)}<small> / mo</small></div>
              <div className="sub">Discord + live signals + the room</div>
              <ul className="perks">
                <li>Private Discord access</li>
                <li>Daily live signals</li>
                <li>Session discussions</li>
                <li>Evening recaps</li>
              </ul>
              <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-g">Join the room</Link>
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
              <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-p">Get full access &rarr;</Link>
            </div>

            {/* Premium Yearly */}
            <div className="pc">
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
              <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-g">Lock in yearly &rarr;</Link>
            </div>
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
            <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="btn-p">Stop trading blind</Link>
            <Link href="#modules" prefetch={false} className="btn-g">See the desk</Link>
          </div>
        </div>
      </section>

      {/* ═══ §7 NAVIGATION FOOTER ═══ */}
      <footer className="site-footer">
        <span className="sf-ghost" aria-hidden="true">BLACKOUT</span>
        <div className="sf-grid">
          {/* Col 1: Brand + Social */}
          <div className="sf-col">
            <div className="sf-brand-name">BLACKOUT</div>
            <div className="sf-brand-tag">Trade like the lights are on.</div>
            <div className="sf-socials">
              <a href="#" className="sf-social" aria-label="X / Twitter">
                <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </a>
              <a href="#" className="sf-social" aria-label="Instagram">
                <svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
              </a>
              <a href="#" className="sf-social" aria-label="Discord">
                <svg viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" /></svg>
              </a>
            </div>
          </div>

          {/* Col 2: Instruments */}
          <div className="sf-col">
            <div className="sf-col-title">Instruments</div>
            <Link href="/dashboard">SPX Slayer</Link>
            <Link href="/flows">HELIX</Link>
            <Link href="/heatmap">BlackOut Thermal</Link>
            <Link href="/terminal">Largo</Link>
            <Link href="/nighthawk">Night Hawk</Link>
            <Link href="/pricing">Vector</Link>
          </div>

          {/* Col 3: Platform */}
          <div className="sf-col">
            <div className="sf-col-title">Platform</div>
            <Link href="/learn">Learn</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/sign-in">Sign in</Link>
            <Link href="#pricing">Pricing</Link>
          </div>

          {/* Col 4: CTA */}
          <div className="sf-col sf-cta-col">
            <div className="sf-col-title">Start now</div>
            <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="sf-cta-btn">Get started &rarr;</Link>
            <p className="sf-cta-desc">Institutional-grade intelligence.<br />Community from {usd(MEMBERSHIP_PRICING.community)}/mo.</p>
          </div>
        </div>

        <div className="sf-bottom">
          <div className="sf-copy">&copy; 2026 BlackOut Trading</div>
          <div className="sf-bottom-links">
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="#">Disclaimer</a>
          </div>
        </div>
      </footer>

      {/* ═══ MOBILE STICKY CTA ═══ */}
      <div className="mobile-sticky-cta" id="mobile-sticky-cta">
        <div className="sticky-text">
          <strong>{signedIn ? "Open desk" : "Get access"}</strong>
          From {usd(MEMBERSHIP_PRICING.monthly)}/mo
        </div>
        <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="sticky-btn">
          Start now &rarr;
        </Link>
      </div>

      <LandingRedesignFx />
    </div>
  );
}
