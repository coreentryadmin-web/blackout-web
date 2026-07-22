import Link from "next/link";
import type { CSSProperties } from "react";
import { MARKETING_PRODUCTS } from "@/lib/marketing/products";
import { LandingRedesignFx } from "./LandingRedesignFx";

/** Bento column spans per module id — tiles 6 modules into three 6-col rows. */
const SPAN: Record<string, "big" | "wide" | ""> = {
  spx: "big", helix: "", thermal: "wide", largo: "wide", hawk: "wide", vector: "wide",
};

const STATS = [
  { v: "6", l: "Desk modules", c: "var(--rl-bull)" },
  { v: "Live", l: "Tick-by-tick tape", c: "var(--rl-cyan)" },
  { v: "A–F", l: "Graded play log", c: "var(--rl-gold)" },
  { v: "1", l: "Membership · all tools", c: "var(--rl-violet)" },
];

const STEPS = [
  { n: "01", tag: "READ THE STRUCTURE", c: "var(--rl-bull)", h: "See the whole floor at once", p: "Live SPX, options flow, dealer gamma and dark-pool prints on one surface — structure before price moves." },
  { n: "02", tag: "SCORE THE SETUP", c: "var(--rl-cyan)", h: "Grades, not guesses", p: "Graded reads and Largo surface the setup, the strike, and the invalidation — every alert gated by the BIE stack." },
  { n: "03", tag: "EXECUTE YOUR WAY", c: "var(--rl-violet)", h: "Your broker, your trigger", p: "We surface the structure. You trade where you already execute — pure intelligence, zero order routing." },
];

const PILLARS = [
  { c: "var(--rl-bull)", h: "Professional-grade feeds", p: "Feeds professional desks pay a premium for." },
  { c: "var(--rl-cyan)", h: "Real-time, tick by tick", p: "Live streams — no 15-minute delays." },
  { c: "var(--rl-violet)", h: "Pure intelligence layer", p: "No order routing — intel, then your trigger." },
  { c: "var(--rl-ember)", h: "Built for focused traders", p: "One decision surface — no noise." },
];

const COMPARE: [string, "y" | "n" | "p", "y" | "n" | "p"][] = [
  ["Live options flow (tick-by-tick)", "y", "n"],
  ["0DTE SPX gamma matrix", "y", "n"],
  ["Dealer GEX / charm heatmaps", "y", "p"],
  ["AI desk analyst on live tape", "y", "n"],
  ["Graded play log (A–F)", "y", "n"],
  ["No broker lock-in", "y", "p"],
  ["One membership · all modules", "y", "n"],
];

const LADDER: [string, number, string][] = [
  ["7585", 0.92, "#00e676"], ["7560", 0.61, "#00e676"], ["6472", 0.34, "#22d3ee"],
  ["6455", 0.5, "#bf5fff"], ["6420", 0.74, "#bf5fff"],
];

function cmpCell(v: "y" | "n" | "p") {
  if (v === "y") return <span className="rl-c rl-yes">✓</span>;
  if (v === "p") return <span className="rl-c rl-par">~</span>;
  return <span className="rl-c rl-no">—</span>;
}

/** Redesigned homepage body — server-rendered content + one client FX layer (canvas, reveal, ticker). */
export function RedesignHome({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="rl">
      {/* HERO */}
      <header className="rl-hero" id="rl-top">
        <canvas className="rl-hero-canvas" id="rl-gex" aria-hidden />
        <div className="rl-hero-veil" aria-hidden />
        <div className="rl-wrap">
          <div className="rl-hero-grid">
            <div className="rl-reveal rl-in">
              <span className="rl-kicker"><span className="dot" aria-hidden />Institutional options desk</span>
              <h1 className="rl-hero-h1">Trade like<br />the lights<br /><span className="on">are on.</span></h1>
              <p className="rl-hero-lede">Options flow, dealer positioning, live gamma structure, and the Night Hawk swing scanner — <b>one command surface for the floor.</b> The intelligence layer institutions pay a premium for, unified by BlackOut Intelligence.</p>
              <div className="rl-cta-row">
                <Link href={signedIn ? "/dashboard" : "/sign-up"} prefetch={false} className="rl-btn rl-btn-primary">{signedIn ? "Open desk →" : "Get access →"}</Link>
                <Link href="#rl-modules" prefetch={false} className="rl-btn rl-btn-ghost">See the desk</Link>
              </div>
              <ul className="rl-creds">
                <li>Real-time dealer positioning</li><li>Institutional-grade feeds</li><li>One command surface</li>
              </ul>
            </div>
            <div className="rl-reveal rl-in" style={{ transitionDelay: ".12s" }}>
              <div className="rl-desk">
                <div className="rl-desk-top">
                  <span className="d" /><span className="d" /><span className="d" />
                  <span className="lbl">SPX Slayer · 0DTE</span>
                  <span className="rl-desk-live"><span className="b" />LIVE</span>
                </div>
                <div className="rl-desk-body">
                  <div className="rl-desk-row"><span className="k">Spot</span><span className="v" id="rl-spot" style={{ color: "var(--rl-ink)" }}>6472.15</span></div>
                  <div className="rl-desk-row"><span className="k">Gamma flip</span><span className="v" style={{ color: "var(--rl-cyan)" }}>6455.0</span></div>
                  <div className="rl-desk-row"><span className="k">Regime</span><span className="v" style={{ color: "var(--rl-bull)", fontSize: 13 }}>NET-LONG · SUPPRESSED</span></div>
                  <div className="rl-ladder">
                    {LADDER.map(([s, m, c]) => (
                      <div className="rl-lrow" key={s}>
                        <span className="s">{s}</span>
                        <div className="bar" style={{ background: `${c}1a` }}><i style={{ background: c, transform: `scaleX(${m})`, boxShadow: `0 0 10px ${c}` }} /></div>
                        <span className="p">{Math.round(m * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="rl-playchip">
                    <span className="rl-grade">A</span>
                    <div>
                      <div className="pt">Call-wall fade · 7585</div>
                      <div className="ps">BIE verified · invalidation 7602 · size ¼</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="rl-floor">
            <span className="hook">Serious traders don&apos;t wait for the tape.</span>
            <span className="sub">Neither does BlackOut Intelligence.</span>
          </p>
        </div>
      </header>

      {/* TAPE */}
      <div className="rl-tape" aria-hidden><div className="rl-tape-track" id="rl-tape" /></div>

      {/* STATS */}
      <section className="rl-stats">
        <div className="rl-wrap">
          <div className="rl-stats-grid rl-reveal">
            {STATS.map((s) => (
              <div className="rl-stat" key={s.l}><span className="v" style={{ color: s.c }}>{s.v}</span><span className="l">{s.l}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* MODULES */}
      <section className="rl-sec" id="rl-modules">
        <div className="rl-wrap">
          <div className="rl-sec-head rl-reveal">
            <span className="rl-kicker"><span className="dot" aria-hidden />The unified terminal</span>
            <h2>Multiple modules.<br /><span className="rl-gt">One edge.</span></h2>
            <p>Purpose-built modules — like the best terminals — unified by one verification gate, one live tape, no broker lock-in. Each is built for a dimension of trading intelligence.</p>
          </div>
          <div className="rl-bento">
            {MARKETING_PRODUCTS.map((m, i) => {
              const size = SPAN[m.id] ?? "";
              const soon = m.launchStatus === "soon";
              return (
                <article key={m.id} className={`rl-mod rl-reveal ${size}`} style={{ "--a": m.accent, transitionDelay: `${i * 0.05}s` } as CSSProperties}>
                  <div className="rl-mod-top">
                    <span className="rl-mod-idx">{String(m.index).padStart(2, "0")}</span>
                    <span className="rl-mod-tag">{m.tag}</span>
                    {soon && <span className="rl-mod-soon">Soon</span>}
                  </div>
                  <div className="rl-mod-name">{m.label}</div>
                  <div className="rl-mod-hl">{m.headline}</div>
                  {size === "big" ? (
                    <ul>{m.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                  ) : (
                    <div className="rl-mod-lede">{m.lede}</div>
                  )}
                  <div className="rl-mod-foot">
                    <div className="rl-mod-stat"><span className="k">{m.stat.k}</span><span className="v">{m.stat.v}</span></div>
                    <Link href={m.href} prefetch={false} className="rl-mod-link">{soon ? "Get early access →" : `Open ${m.label} →`}</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* FLOW */}
      <section className="rl-sec" id="rl-flow" style={{ paddingTop: 0 }}>
        <div className="rl-wrap">
          <div className="rl-sec-head rl-reveal">
            <span className="rl-kicker"><span className="dot" aria-hidden />How it works</span>
            <h2>Read. Score. <span className="rl-gt">Execute.</span></h2>
          </div>
          <div className="rl-flow">
            {STEPS.map((s, i) => (
              <div className="rl-step rl-reveal" key={s.n} style={{ transitionDelay: `${i * 0.08}s` }}>
                <span className="n" style={{ color: s.c }}>{s.n}</span>
                <span className="tag" style={{ color: s.c }}>{s.tag}</span>
                <h3>{s.h}</h3><p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EDGE */}
      <section className="rl-sec" id="rl-edge" style={{ paddingTop: 0 }}>
        <div className="rl-wrap">
          <div className="rl-sec-head rl-reveal">
            <span className="rl-kicker"><span className="dot" aria-hidden />The edge</span>
            <h2>Same toolkit.<br /><span className="rl-gt">Better stack.</span></h2>
          </div>
          <div className="rl-pillars">
            {PILLARS.map((p, i) => (
              <div className="rl-pillar rl-reveal" key={p.h} style={{ transitionDelay: `${i * 0.06}s` }}>
                <span className="d" style={{ background: p.c, boxShadow: `0 0 10px ${p.c}` }} />
                <h4>{p.h}</h4><p>{p.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="rl-sec" id="rl-pricing" style={{ paddingTop: 0 }}>
        <div className="rl-wrap">
          <div className="rl-sec-head rl-reveal">
            <span className="rl-kicker"><span className="dot" aria-hidden />Membership</span>
            <h2>One desk. <span className="rl-gt">One price.</span></h2>
            <p>Retail platforms stitch delayed feeds and chat bots. We ship one verified desk — priced for traders who already pay for edge.</p>
          </div>
          <div className="rl-price">
            <div className="rl-compare rl-reveal">
              <div className="rl-compare-h"><span>Capability</span><span className="bo">BlackOut</span><span>Typical</span></div>
              {COMPARE.map((r) => (
                <div className="rl-crow" key={r[0]}><span className="f">{r[0]}</span>{cmpCell(r[1])}{cmpCell(r[2])}</div>
              ))}
            </div>
            <div className="rl-tiers rl-reveal" style={{ transitionDelay: ".1s" }}>
              <div className="rl-tier"><div className="plan">Community</div><div className="amt">$75<small>/mo</small></div><div className="sub">Discord · live signals · the room</div></div>
              <div className="rl-tier best">
                <div className="badge">Full desk</div>
                <div className="plan" style={{ color: "var(--rl-bull)" }}>Premium</div>
                <div className="amt">$199<small>/mo</small></div>
                <div className="sub">Every module + Discord · one membership</div>
                <Link href="/sign-up" prefetch={false} className="rl-btn rl-btn-primary" style={{ width: "100%", marginTop: 16 }}>Start now →</Link>
              </div>
              <div className="rl-tier"><div className="plan">Premium · Yearly</div><div className="amt">$1,999<small>/yr</small></div><div className="sub">Full desk · save $389 vs monthly</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING */}
      <section className="rl-closing">
        <div className="rl-wrap">
          <span className="rl-kicker" style={{ justifyContent: "center" }}><span className="dot" aria-hidden />Ready when you are</span>
          <h2>Stop trading <span className="rl-gt">blind.</span></h2>
          <p>Six modules. One verified tape. Your broker, your trigger — start with the full desk today.</p>
          <div className="rl-cta-row">
            <Link href="/sign-up" prefetch={false} className="rl-btn rl-btn-primary">Get started →</Link>
            <Link href="/pricing" prefetch={false} className="rl-btn rl-btn-ghost">See pricing</Link>
          </div>
        </div>
      </section>

      <LandingRedesignFx />
    </div>
  );
}
