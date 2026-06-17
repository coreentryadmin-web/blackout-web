import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Nav />

      {/* ── Hero ── */}
      <section className="relative min-h-[92vh] flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        {/* Eclipse glow layers */}
        <div className="absolute inset-0 bg-eclipse-glow pointer-events-none" />
        <div
          className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ boxShadow: "0 0 200px 60px rgba(255,255,255,0.04)" }}
        />
        <div className="eclipse-ring absolute top-[8%] left-1/2 -translate-x-1/2 w-[220px] h-[220px]" />
        <div className="eclipse-ring absolute top-[4%] left-1/2 -translate-x-1/2 w-[320px] h-[320px] opacity-40" />

        <p className="text-[10px] tracking-[5px] text-text-muted uppercase mb-4 relative z-10">
          Institutional-grade intelligence
        </p>

        <h1
          className="font-display text-[100px] md:text-[130px] tracking-[10px] leading-none text-white relative z-10 text-glow"
        >
          BLACKOUT
        </h1>

        <p className="text-[11px] tracking-[8px] text-text-secondary uppercase mt-2 relative z-10">
          Trade.&nbsp; Execute.&nbsp; Dominate.
        </p>

        <p className="max-w-lg mt-8 text-[15px] text-text-secondary leading-relaxed font-light relative z-10">
          Real-time options flow, AI-powered market intelligence, live SPX analysis,
          and the Night Hawk swing scanner — built for traders who don&apos;t guess.
        </p>

        <div className="flex gap-4 mt-10 relative z-10">
          <Link
            href="/sign-up"
            className="bg-white text-black px-10 py-3.5 text-[11px] tracking-[3px] uppercase font-bold hover:bg-white/90 transition-opacity"
          >
            Start Trading
          </Link>
          <Link
            href="#features"
            className="border border-surface-3 text-text-secondary px-10 py-3.5 text-[11px] tracking-[3px] uppercase font-semibold hover:border-surface-4 hover:text-text-primary transition-colors"
          >
            See the Platform
          </Link>
        </div>

        {/* Stats bar */}
        <div className="flex gap-12 mt-20 pt-10 border-t border-surface-2 relative z-10">
          {[
            { num: "93K+", label: "Flow Alerts" },
            { num: "4", label: "Live AI Systems" },
            { num: "0DTE", label: "SPX Precision" },
            { num: "24/7", label: "Night Hawk" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display text-4xl tracking-[2px] text-white">{s.num}</div>
              <div className="text-[10px] tracking-[2px] uppercase text-text-muted mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="border-t border-surface-2 py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-[10px] tracking-[4px] text-text-muted uppercase mb-3">Platform</p>
          <h2 className="font-display text-5xl tracking-[4px] text-white mb-12">
            EVERYTHING YOU NEED
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-surface-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-black p-8 hover:bg-surface-1 transition-colors group">
                <div className="text-3xl mb-5">{f.icon}</div>
                <h3 className="font-display text-xl tracking-[2px] text-text-primary mb-2">
                  {f.title}
                </h3>
                <p className="text-[13px] text-text-secondary leading-relaxed">{f.desc}</p>
                <span
                  className={`inline-block mt-4 text-[9px] tracking-[2px] uppercase px-2 py-1 border ${
                    f.tier === "Elite"
                      ? "border-yellow-900/60 text-yellow-600"
                      : "border-surface-3 text-text-muted"
                  }`}
                >
                  {f.tier}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Terminal preview ── */}
      <section className="border-t border-surface-1 bg-[#030303] py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[10px] tracking-[4px] text-text-muted uppercase mb-3">AI Terminal</p>
            <h2 className="font-display text-5xl tracking-[3px] text-white mb-4 leading-tight">
              ASK LARGO.<br />GET AN EDGE.
            </h2>
            <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
              Largo synthesizes live flows, GEX, VWAP, news, analyst ratings, and options data —
              then answers like a desk trader, not a chatbot.
            </p>
            <Link
              href="/sign-up"
              className="bg-white text-black px-10 py-3.5 text-[11px] tracking-[3px] uppercase font-bold hover:bg-white/90 transition-opacity inline-block"
            >
              Try the Terminal
            </Link>
          </div>

          {/* Terminal UI mock */}
          <div className="bg-[#0a0a0a] border border-surface-3 rounded-sm overflow-hidden">
            <div className="bg-surface-2 px-4 py-3 flex items-center gap-2 border-b border-surface-3">
              <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
              <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
              <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
              <span className="ml-2 text-[10px] tracking-[2px] uppercase text-text-muted">
                Largo — BlackOut AI Desk
              </span>
            </div>
            <div className="p-5 font-mono">
              <div className="flex gap-3 text-[12px]">
                <span className="text-surface-4">›</span>
                <span className="text-text-secondary">How is SPY looking for 6/18?</span>
              </div>
              <div className="mt-4 text-[12px] text-text-muted leading-loose">
                <p>
                  SPY is{" "}
                  <span className="text-white">bearish into 6/18 expiry.</span> GEX flip at{" "}
                  <span className="text-white">$595</span> — we&apos;re below it. Max pain{" "}
                  <span className="text-white">$590</span> with $2.1B in put OI.
                </p>
                <p className="mt-3 text-[11px] text-surface-4">
                  Key levels: support $588.40 (VAL), resistance $594.20 (POC). Flow streak bearish 5d.
                </p>
                <p className="mt-3 text-[11px] text-surface-4">
                  Want me to pull the options chain for a specific strike?
                </p>
              </div>
              <div className="flex gap-3 mt-4 text-[12px]">
                <span className="text-surface-3">›</span>
                <span className="inline-block w-2 h-3.5 bg-white/70 animate-blink" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-t border-surface-2 py-24 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-[10px] tracking-[4px] text-text-muted uppercase mb-3">Pricing</p>
          <h2 className="font-display text-5xl tracking-[4px] text-white mb-12">
            CHOOSE YOUR TIER
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-surface-2">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`bg-black p-10 flex flex-col ${t.featured ? "border-t-2 border-white" : ""}`}
              >
                <p className={`text-[10px] tracking-[4px] uppercase mb-3 ${t.featured ? "text-text-secondary" : "text-text-muted"}`}>
                  {t.name}
                </p>
                <div className="font-display text-6xl tracking-[2px] text-white leading-none">
                  {t.price}
                </div>
                <p className="text-[11px] text-text-muted mt-1 mb-8">{t.period}</p>

                <ul className="flex flex-col gap-3 mb-10 flex-1">
                  {t.features.map((f) => (
                    <li key={f.text} className="flex gap-3 text-[13px]">
                      <span className={f.active ? "text-white" : "text-surface-4"}>
                        {f.active ? "✓" : "—"}
                      </span>
                      <span className={f.active ? "text-text-secondary" : "text-surface-4"}>
                        {f.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/sign-up"
                  className={`w-full py-3 text-center text-[11px] tracking-[3px] uppercase font-bold transition-colors ${
                    t.featured
                      ? "bg-white text-black hover:bg-white/90"
                      : "border border-surface-3 text-text-muted hover:border-surface-4 hover:text-text-secondary"
                  }`}
                >
                  {t.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-surface-2 px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <span className="font-display text-xl tracking-[4px] text-white">BLACKOUT</span>
        <p className="text-[11px] text-text-muted tracking-[1px]">
          © 2026 BlackoutTrading.com — Trade. Execute. Dominate.
        </p>
        <p className="text-[10px] text-surface-4">Not financial advice.</p>
      </footer>
    </div>
  );
}

const FEATURES = [
  { icon: "⚡", title: "SPX LIVE DASHBOARD", desc: "Real-time GEX levels, VWAP, regime detection, dealer positioning, and live 0DTE play alerts.", tier: "Pro" },
  { icon: "📊", title: "OPTIONS FLOW FEED", desc: "Unusual Whales-powered whale and dark pool alerts. Filter by premium, DTE, ticker, and flow type.", tier: "Pro" },
  { icon: "🌡", title: "SECTOR HEATMAPS", desc: "Live sector rotation and stock performance heatmaps. See where institutional money is moving.", tier: "Pro" },
  { icon: "🤖", title: "AI TERMINAL — LARGO", desc: "Ask anything. Largo synthesizes flows, technicals, news, and analyst data into sharp, direct answers.", tier: "Elite" },
  { icon: "🦅", title: "NIGHT HAWK SCANNER", desc: "Automated 2–10 DTE swing play detection. Full dossier: flows, news, IV rank, technicals, analyst ratings.", tier: "Elite" },
  { icon: "📋", title: "PRE-MARKET BRIEFINGS", desc: "AI-generated SPX briefings at 6 AM PT. Overnight flow, macro calendar, key levels.", tier: "Elite" },
];

const TIERS = [
  {
    name: "Free", price: "$0", period: "forever", featured: false, cta: "Get Started",
    features: [
      { text: "Flow Feed (delayed 15m)", active: true },
      { text: "Basic heatmap", active: true },
      { text: "SPX Dashboard", active: false },
      { text: "AI Terminal", active: false },
      { text: "Night Hawk plays", active: false },
    ],
  },
  {
    name: "Pro", price: "$97", period: "per month", featured: true, cta: "Join Pro",
    features: [
      { text: "Live Flow Feed", active: true },
      { text: "Full heatmaps", active: true },
      { text: "SPX Live Dashboard", active: true },
      { text: "Pre-market briefings", active: true },
      { text: "AI Terminal", active: false },
    ],
  },
  {
    name: "Elite", price: "$197", period: "per month", featured: false, cta: "Join Elite",
    features: [
      { text: "Everything in Pro", active: true },
      { text: "AI Terminal — Largo", active: true },
      { text: "Night Hawk Scanner", active: true },
      { text: "Priority Discord access", active: true },
      { text: "1-on-1 onboarding", active: true },
    ],
  },
];
