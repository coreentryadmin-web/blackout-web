import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const vectorGuide = defineToolGuide({
  slug: "vector",
  chapter: 8,
  title: "Vector",
  description:
    "Cross-ticker gamma and flow radar — a universe screener with ranked setups, GEX ladders, wall integrity scoring, and session replay.",
  overview: [
    "SPX Slayer and Thermal go deep on one ticker at a time. Vector extends the same dealer gamma exposure framework across the entire universe at once — a live screener that ranks setups so you never have to guess which name to look at next. Route: `/vector`.",
    "The desk is one chart plus three linked rails: a GEX/VEX matrix ladder, a live HELIX flow tape, and a fused Play card with ranked option contract picks — all scoped to whichever ticker you select from the universe scanner or type into search.",
    "Underneath the chart, a collapsible Universe scanner ranks the whole covered list by preset (nearest flip, most pinned, most explosive) — this is Vector's real differentiator: automated, whole-market ranking, not a ticker you have to pick first.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Four-column grid on desktop: GEX/VEX matrix ladder (left), chart (center), Live Helix flow tape (right), and a fourth column stacking the Play card, intel strip, and contract picks. Below the grid: the Universe scanner, collapsed by default.",
      "The chart itself carries a full toolbar — timeframe, indicator menu, draw tools, replay controls, GEX/VEX lens toggle, DTE horizon (0DTE/Weekly/Monthly), node count, dark pool overlay — and an alerts bell in the top-right.",
      "On mobile/native app shell, panels collapse into a segmented control: Chart · Plays · Helix · Matrix · Scanner — only one mounts at a time.",
    ],
  },
  panels: [
    {
      name: "Universe scanner",
      location: "Below the chart grid — collapsible",
      purpose: "Ranks the covered ticker universe by preset so you find the setup instead of hunting for it.",
      shows: [
        "Ticker, spot, regime (above/below flip), gamma flip + distance %, call wall + distance %, put wall + distance %",
        "Freshness chip — \"Updated {age} ago\", flips to a warning style past 10 minutes stale",
      ],
      actions: [
        "Switch preset: All / Nearest flip / Most pinned / Most explosive",
        "Click a row to load that ticker across the whole desk",
      ],
      cadence: "Client polls every 5s; underlying snapshot rebuilds every 5 min during RTH only (serves the last RTH read off-hours, honestly aged)",
      consume:
        "Nearest flip surfaces names closest to a regime change — the most actionable list. Most pinned finds strong walls above flip (mean-revert candidates). Most explosive finds names below flip near it (vol-expansion risk). A ticker with no flip data always sorts to the bottom, never falsely ranked.",
      tip: "The universe is a fixed ~21-name liquid list, but any ticker you open on Vector, Thermal, or HELIX gets added to tomorrow's warm set automatically — the platform learns what you actually watch.",
    },
    {
      name: "GEX/VEX Matrix ladder",
      location: "Left rail",
      purpose: "Strike-row ladder for the active ticker's dealer gamma or vanna exposure.",
      shows: [
        "Strike rows with exposure value and drift % vs session",
        "Spot row, King node (largest |GEX| on the board), call-wall and put-wall row highlighting",
        "As-of timestamp",
      ],
      actions: ["Toggle GEX / VEX lens", "Click a strike to flash that level on the chart", "\"⟳ SPOT\" resets scroll to the spot row"],
      cadence: "5s for SPX/SPY/QQQ and overlay-eligible tickers; 15s for everything else",
      consume:
        "Scope follows the chart's DTE horizon toggle (0DTE/Weekly/Monthly). The visible strike band syncs to the chart's own zoom, so scrolling the chart moves the ladder with it.",
    },
    {
      name: "Chart — indicators, DTE horizon, replay",
      location: "Center",
      purpose: "The core price chart with dealer-positioning and flow overlays layered on top.",
      shows: [
        "Candles at 1/3/5/15/30/60min (default 3min)",
        "Indicator menu: VWAP/EMA/SMA, key levels (HOD/LOD, opening range, fib, PDH/PDL, floor pivots), market structure, RSI/MACD, confluence zones, options flow, expected-move cone, GEX heatmap overlay, gamma regime zones, volume profile",
        "Bead trail: dots per strike row showing wall strength/persistence over the session, with event glyphs (wall building/fading/gone, flip cross, wall break)",
      ],
      actions: [
        "GEX / VEX lens toggle",
        "DTE horizon: 0DTE / Weekly / Monthly",
        "Replay: step, play/pause, speed 0.5×–8×, jump to open/close, loop, scrub",
        "\"F\" for focus mode (unmounts every rail, chart only)",
      ],
      cadence: "Live spot tick every 1s (SSE); bead/wall-history sample every 5s (oracle/universe tickers) or 15s (others)",
      consume:
        "Defaults on: VWAP, market structure, volume profile — everything else is opt-in from the indicator menu. Replay freezes the Play card and contract picks at the last live frame with a REPLAY badge, so you can study history without the live engine reacting to stale replayed data.",
      tip: "GEX/VEX only on Vector, unlike Thermal's four lenses — Vector trades ladder depth for universe breadth.",
    },
    {
      name: "Play card + desk intel strip",
      location: "Fourth column, top",
      purpose: "One fused trade idea per ticker — regime, magnet, proximity, confluence, and wall integrity combined into a single grade.",
      shows: [
        "Letter grade (A–C) + conviction %, style (scalp/swing/position by DTE), bias, entry zone, targets, invalidation",
        "Intel strip chips: Regime (long/short gamma), Move (expected-move headline), Confluence (top zone), Wall (integrity note)",
      ],
      actions: ["Open the Analytics drawer for the full evidence breakdown"],
      cadence: "Recomputes with each matrix/spot update; freezes during replay",
      consume:
        "Long gamma reads fade extremes toward the magnet (range play); short gamma reads momentum toward the next wall. The card renders nothing when there's no spot yet — an absent card is honest, not a bug.",
    },
    {
      name: "Contract Picks",
      location: "Fourth column, below the Play card",
      purpose: "Up to 3 real, buy-to-open option contracts ranked across DTE buckets — never a fabricated strike.",
      shows: [
        "Rank, side, strike/expiry/DTE, live premium + drift % from entry",
        "Action-status chip: Still buy / Caution / Don't buy, plus STALE/ELITE/Primary tags",
      ],
      actions: ["Click a pick to open its drawer: Desk data (cross-product evidence) and Option play (execution detail + why-ranked reasons)"],
      cadence: "Live quote refresh on the contract-picks feed",
      consume:
        "Roles span primary long/short, range fade, HELIX whale anchor, GEX king pin, and magnet mean — a deeper backfill pool exists if the top picks all read Don't buy. The displayed confidence is always the Play card's own conviction number reused, never a second invented score.",
    },
    {
      name: "Live Helix rail",
      location: "Right rail",
      purpose: "Ticker-scoped flow tape — the same institutional-flow read HELIX ships, filtered to the active symbol.",
      shows: ["Recent and Top-by-premium sections, filterable ALL/CALL/PUT", "Side, strike, expiry/DTE, premium, alert time, score, WHALE pill for large prints"],
      actions: ["Click a card to open the shared drilldown drawer and flash that strike on the chart", "\"Open full Helix tape\" link to /flows"],
      cadence: "Live",
      consume: "Off-hours shows an honest empty state rather than stale prints: \"Session closed — Live Helix resumes at the open.\"",
    },
    {
      name: "Alerts",
      location: "Bell icon, top-right of the toolbar",
      purpose: "Per-ticker wall-touch and flip-cross alerts with anti-spam design.",
      shows: ["Active alert count on the bell", "Recent-fires list (last 20, showing 4)"],
      actions: ["Set wall-touch tolerance % or flip-cross alert", "In-page toast + optional OS notification while the tab is backgrounded"],
      cadence: "Rising-edge state machine — fires once per approach, needs the condition to clear (1.8× tolerance) plus a 60s cooldown before re-arming",
      consume: "Alerts persist per ticker in your browser and mirror to the server best-effort — they fire while this tab is open or backgrounded, not to a fully closed tab.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "One live snapshot per ticker feeds every rail — the matrix, Play card, and contract picks all read the same GEX/VEX computation family the SPX Slayer and Thermal desks use, scoped to whichever symbol is active.",
    ],
    features: [
      { title: "Universe over single-ticker", body: "The scanner ranks the whole covered list automatically — no manual ticker-by-ticker hunting." },
      { title: "Never fabricated", body: "The Play card and contract picks render nothing rather than invent a level or a strike when data is missing." },
      { title: "Wall integrity, not just presence", body: "Strength, persistence, and isolation are scored separately — a wall that just appeared reads differently from one that's held for an hour." },
      { title: "Confluence needs distinct kinds", body: "Five overlapping fib lines don't count as confluence — a zone needs two or more DIFFERENT level types stacked to register." },
    ],
  },
  usage: {
    intro: "Open the scanner before you open a chart — let it tell you where to look.",
    steps: [
      { title: "Scan the universe", body: "Pick a preset (nearest flip, most pinned, most explosive) and scan the ranked list." },
      { title: "Select a ticker", body: "Click a row — the whole desk loads that symbol's chart, ladder, flow, and play." },
      { title: "Read the Play card", body: "Check grade, conviction, bias, and the entry/target/invalidation levels." },
      { title: "Cross-check the ladder", body: "Confirm the wall levels the Play card cites against the GEX/VEX matrix." },
      { title: "Check contract picks", body: "Review the ranked real contracts before sizing — watch for STALE or Don't buy tags." },
      { title: "Set an alert if not trading now", body: "Wall-touch or flip-cross so you don't have to babysit the screen." },
    ],
  },
  crossLinks: [
    CROSS.thermal("The deep single-ticker heatmap Vector's matrix ladder summarizes."),
    CROSS.spx("SPX Slayer executes on SPX specifically — Vector's SPX row is one line among many."),
    CROSS.helix("Full flow tape for a ticker beyond what the ladder-scoped rail shows."),
    CROSS.largo("Ask follow-up questions about any ticker's GEX, regime, and walls."),
  ],
  dos: [
    "Start from the Universe scanner, not a blank chart.",
    "Cross-check the Play card's levels against the GEX/VEX ladder before sizing.",
    "Watch for STALE tags on contract picks before trusting a live premium.",
    "Use replay to study a session's structure, not to trade off frozen data.",
  ],
  donts: [
    "Don't treat the scanner's ~21-name universe as the entire market — it's the liquid, covered set.",
    "Don't assume the Play card's conviction number and the contract pick's confidence are two independent reads — they're the same number.",
    "Don't expect DEX/CHARM lenses here — Vector ships GEX/VEX only; Thermal has all four.",
  ],
  faq: [
    { q: "Vector vs Thermal — which do I open first?", a: "Vector to find the setup across the universe; Thermal to go deep once you have a ticker. Thermal is genuinely multi-ticker too — Vector's edge is ranking all of them automatically, not that Thermal is restricted to one." },
    { q: "Why does the Play card sometimes show nothing?", a: "It only renders once real spot/matrix data exists for the ticker — an absent card means data isn't ready yet, not a broken feature." },
    { q: "How stale can the Universe scanner get?", a: "The underlying snapshot rebuilds every 5 minutes during RTH; the age chip turns a warning color past 10 minutes so staleness is always disclosed, never hidden." },
  ],
});
