import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const blackoutGridGuide = defineToolGuide({
  slug: "blackout-grid",
  chapter: 8,
  title: "BlackOut Grid",
  description:
    "Cross-market intelligence board — twelve modular panels for news, flow, GEX, earnings, macro, and situational awareness.",
  overview: [
    "Grid aggregates panels you can show, hide, collapse, and reorder — a single pre-market and intraday situational awareness board. Route: `/grid`.",
    "Global ticker filter (GridSearchBar) scopes most panels to one symbol; Movers, Economy, and Sectors stay market-wide by design.",
    "Bootstrap prefetch seeds SWR caches on first paint for faster load. Layout persists in localStorage (`blackout:grid:layout:v1`).",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Page header with GridSearchBar in actions — type a ticker (1–5 letters), Enter to commit, `/` to focus, Esc to clear. GridBanner shows active filter with clear control.",
      "GridToolbar shows visible panel count; GridPanelsMenu toggles visibility, collapse all, expand all, reset layout.",
      "Masonry board: Market Pulse spans full width at top; remaining eleven panels tile in responsive spans (1–2 columns each).",
    ],
  },
  panels: [
    {
      name: "Market Pulse",
      location: "Full-width hero row — top of board",
      purpose: "Session-wide tape snapshot: indices, breadth, tide, and GEX posture chip.",
      shows: [
        "SPX price and % change, VIX %",
        "Advance/decline, TRIN, TICK",
        "Tide bias, VWAP above/below",
        "Gamma flip, GEX posture chip (POS/NEG γ + flip)",
      ],
      actions: ["Collapse/hide via GridCard chrome"],
      cadence: "SPX merged 20s; GEX chip 60s",
      consume:
        "Your 30-second market read. Compare tide and GEX posture before opening Slayer. Pulse disagreements with Night Hawk thesis are a pre-market invalidate signal.",
    },
    {
      name: "Unified News",
      location: "Masonry — span 2",
      purpose: "Headline rail — market-wide Benzinga or per-ticker article list.",
      shows: [
        "Market: BenzingaNewsRail stream",
        "Ticker filter: up to 20 articles with time, tickers, title, external links",
      ],
      actions: ["Open articles in new tab", "Collapse/hide"],
      cadence: "Ticker mode 30s; market rail internal SWR",
      consume:
        "Pre-market: scan for macro headlines that override micro GEX. Ticker mode when researching a single name before earnings or catalyst panel drill-down.",
    },
    {
      name: "Notable Flow",
      location: "Masonry — span 1",
      purpose: "Whale-first options flow summary — HELIX data plane in compact form.",
      shows: [
        "Market: live SSE tape, $1M+ prints (ticker, call/put, strike, premium, whale icon)",
        "Ticker: last 3 days grouped, $1M+ only",
      ],
      actions: ["Collapse/hide — read only"],
      cadence: "Market: SSE + 30s poll fallback; Ticker: 60s REST",
      consume:
        "Faster than opening full HELIX for a whale scan. When a name repeats here and in Pulse tide shift, prioritize it on the open. Ticker mode for single-name conviction history.",
    },
    {
      name: "Analyst Actions",
      location: "Masonry — span 1",
      purpose: "Analyst ratings, price targets, upgrades, downgrades.",
      shows: [
        "Action tag (UPGRADE, DOWNGRADE, etc.)",
        "Tickers, relative time, title with link when URL present",
      ],
      actions: ["Open Benzinga links", "Collapse/hide"],
      cadence: "Market 120s; Ticker 30s (Redis snapshot from grid-warm cron)",
      consume:
        "Pair with Earnings Radar for same ticker. Upgrades into resistance + negative GEX = different trade than upgrades at put wall support.",
    },
    {
      name: "GEX Regime",
      location: "Masonry",
      purpose: "Dealer gamma regime for SPX or filtered ticker.",
      shows: [
        "Posture headline, γ/ν/θ tags",
        "Flip, call/put walls, spot, nearest wall",
        "Regime read text",
      ],
      actions: ["Collapse/hide"],
      cadence: "30s via gex-positioning API",
      consume:
        "Grid-native GEX snapshot — should rhyme with Slayer header and Thermal for SPX. Use pre-market when Slayer is not yet live. Ticker mode for single-name dealer context.",
    },
    {
      name: "Top Movers",
      location: "Masonry",
      purpose: "Intraday gainers and losers — market-wide only.",
      shows: ["Top 8 gainers and top 8 losers — ticker, price, % change"],
      actions: ["Collapse/hide"],
      cadence: "90s",
      consume:
        "Rotation radar. Leaders appearing in Notable Flow and Movers together suggest theme days. Ticker filter not applicable — always broad market.",
    },
    {
      name: "Earnings Radar",
      location: "Masonry — span 2",
      purpose: "Today's reporters or single-name earnings history.",
      shows: [
        "Market: PRE/AH tag, ticker, name, date, implied move ±%, EPS est/act, surprise",
        "Ticker: next date + 6-quarter history table",
      ],
      actions: ["Collapse/hide"],
      cadence: "Market 300s; Ticker 30s",
      consume:
        "Pre-market essential on reporting days. Implied move vs actual history informs vol sale/buy bias. Cross-check Catalysts panel for same ticker.",
    },
    {
      name: "Dark Pool",
      location: "Masonry",
      purpose: "Off-lit institutional equity prints.",
      shows: ["Ticker, BUY/SELL side, premium — up to 18 rows"],
      actions: ["Collapse/hide"],
      cadence: "Market 90s; Ticker 30s",
      consume:
        "Equity block context — complements options flow in Notable Flow. Large BUY side into a name on HELIX call sweeps strengthens bullish thesis; conflicting side suggests hedge.",
    },
    {
      name: "Congress Trades",
      location: "Masonry",
      purpose: "Congressional disclosure feed.",
      shows: [
        "Party dot, politician, ticker, BUY/SELL, amount range, filed date — up to 18",
      ],
      actions: ["Collapse/hide"],
      cadence: "Market 300s; Ticker 30s",
      consume:
        "Slow-moving sentiment layer — useful for swing context, rarely intraday SPX triggers unless politically tied names dominate news.",
    },
    {
      name: "Macro Indicators",
      location: "Masonry — span 2",
      purpose: "Macro snapshot tiles — market-wide only.",
      shows: [
        "CPI, Fed Funds, GDP, Payrolls, Unemployment, Treasury, Retail Sales",
        "Latest, prior, change % per series",
      ],
      actions: ["Collapse/hide"],
      cadence: "3600s (1h)",
      consume:
        "Background regime context. Refresh mentally on FOMC/CPI weeks — pair with Economic calendar elsewhere. Not intraday actionable for 0DTE.",
    },
    {
      name: "Corporate Catalysts",
      location: "Masonry — span 2",
      purpose: "Event-driven corporate news — FDA, M&A, guidance, insider, etc.",
      shows: ["Type tag, title, relative time — up to 16 items"],
      actions: ["Collapse/hide"],
      cadence: "Market 300s; Ticker 30s",
      consume:
        "Ticker filter mode for single-name deep dive. Explains sudden Notable Flow spikes. Override Slayer micro structure temporarily when high-impact catalyst hits.",
    },
    {
      name: "Sector Heat",
      location: "Masonry — span 2 — last in registry",
      purpose: "SPDR sector ETF heat map — market-wide only.",
      shows: ["11 sector cells with intraday % change, color-coded heat"],
      actions: ["Collapse/hide"],
      cadence: "90s",
      consume:
        "Theme rotation at a glance. Align with Night Hawk MarketContextBar sector leaders. Risk-on/off days show broad color vs single-sector outliers.",
    },
    {
      name: "GridPanelsMenu & layout chrome",
      location: "Toolbar above masonry",
      purpose: "Personalize which panels appear and their collapsed state.",
      shows: ["Per-panel visibility toggles", "Collapse all / Expand all / Reset"],
      actions: [
        "Toggle panel visibility",
        "Reset layout to default",
        "Per-panel collapse in GridCard header",
      ],
      cadence: "Persisted locally — instant UI",
      consume:
        "Pre-market preset: Pulse, News, Earnings, GEX Regime, Catalysts visible; hide Congress if screen is tight. Intraday add Notable Flow. Reset after major UI updates if layout corrupts.",
      tip: "Hidden panels still exist in registry — use menu to restore, not refresh.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "GridBootstrapPrefetch hits /api/grid/bootstrap to warm Redis-backed snapshots. Each panel owns its SWR key and poll interval; ticker context appends ?ticker= where supported.",
    ],
    features: [
      { title: "Modular registry", body: "Twelve panels in PANELS array — order fixed, visibility user-controlled." },
      { title: "Ticker context", body: "React context from GridSearchBar scopes APIs — movers/economy/sectors exempt." },
      { title: "Shared chrome", body: "GridCard supplies collapse, hide, live/idle dot on every module." },
      { title: "Warm cron", body: "grid-warm cron populates Redis for analysts, congress, etc." },
    ],
  },
  usage: {
    intro: "Pre-market scan 8:00–9:30 ET; intraday glance for catalyst interrupts.",
    steps: [
      { title: "Set layout once", body: "Show Pulse, News, GEX, Earnings, Catalysts; hide noise panels on small screens." },
      { title: "Pre-market scan", body: "Read Pulse + News + GEX Regime; check Earnings Radar for today." },
      { title: "Filter ticker when researching", body: "GridSearchBar — Enter commits, Esc clears." },
      { title: "Validate Night Hawk", body: "Catalysts and News confirm or invalidate evening thesis." },
      { title: "Hand off to Slayer", body: "At 9:30, open SPX Slayer — Grid is context, not execution." },
    ],
  },
  crossLinks: [
    CROSS.hawk("Evening thesis validation against overnight Grid scan."),
    CROSS.spx("RTH execution after macro check."),
    CROSS.helix("Deeper flow tape than Notable Flow summary."),
    CROSS.thermal("Full surface when GEX Regime panel is not enough."),
  ],
  dos: [
    "Check earnings and catalysts before FOMC/CPI/reporting days.",
    "Use ticker filter for single-name research sessions.",
    "Keep Pulse visible — it anchors the board.",
    "Persist a lean layout for your monitor size.",
  ],
  donts: [
    "Don't ignore high-impact events when sizing 0DTE.",
    "Don't expect Movers/Economy/Sectors to filter by ticker.",
    "Don't treat Grid flow panel as replacement for HELIX tape.",
  ],
  faq: [
    { q: "Is Grid real-time?", a: "Panel-dependent — each module shows its own poll cadence; Notable Flow uses SSE when market-wide." },
    { q: "Why plain void background?", a: "Calm backdrop — data panels are the focus without animated grid distraction." },
    { q: "Layout reset lost my panels?", a: "Use GridPanelsMenu to re-enable hidden panels — visibility is localStorage, not account-backed." },
  ],
});
