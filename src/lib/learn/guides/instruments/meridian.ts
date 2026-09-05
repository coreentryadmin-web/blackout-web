import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const meridianGuide = defineToolGuide({
  slug: "meridian",
  chapter: 9,
  title: "Meridian",
  description:
    "Catalyst timeline covering earnings, macro releases, OpEx, and FDA decisions — with a five-tab earnings sub-desk as the deepest workflow.",
  overview: [
    "Meridian is not an earnings-only calendar. Four catalyst kinds share one timeline rail: earnings, macro releases (CPI, FOMC, jobs), OpEx (options expiration), and FDA decision dates — each with its own filter chip and an event-specific detail view. Route: `/meridian`.",
    "Earnings gets materially more depth than the other three: selecting an earnings event opens a five-tab sub-desk (Summary, Report, Estimates, Positioning, History) instead of a single detail card.",
    "A second top-level view, Analytics grid, surfaces cross-catalyst patterns — a print clock, revision momentum, mega-cap earnings-week grid, and after-hours movers — for scanning the whole window instead of one event at a time.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Hero strip (freshness, as-of time) and a 5-card stats strip (Catalysts, Earnings, Mega-cap ER, Next 24h, Board names) sit above two view tabs: Timeline and Analytics grid, plus a manual Refresh button.",
      "Timeline view is two-pane: a left rail with search + filter chips + a month-grouped event list, and a right pane hosting the selected event's detail panel.",
      "Selecting an event updates the URL, so a specific catalyst is deep-linkable and survives back/forward navigation.",
    ],
  },
  panels: [
    {
      name: "Catalyst timeline rail",
      location: "Left pane — Timeline view",
      purpose: "Search and filter the full catalyst window, grouped by month.",
      shows: ["Ticker, date, kind badge; a board badge when the ticker is on your Night Hawk board", "\"{n} print(s) hidden — no listed options\" note when server-side filtering hid rows"],
      actions: [
        "Filter chips: All / Macro / Earnings / Imp ≥4 (high-importance) / FDA / OpEx / Watchlist / Board",
        "Free-text ticker/name search",
        "Click a row to open its detail panel",
      ],
      cadence: "Fast lite fetch on load, then polls every 90s; server-side cache refreshes roughly every 2 minutes",
      consume:
        "Imp ≥4 narrows earnings to high-importance prints only, not a separate catalyst kind. Watchlist and Board intersect the timeline with your own lists — use them to cut a multi-week window down to what you actually hold.",
    },
    {
      name: "Event detail — Macro",
      location: "Right pane — macro events",
      purpose: "Context and positioning read for a scheduled macro release (CPI, FOMC, jobs, etc.).",
      shows: [
        "Outlook lean (risk-on/risk-off/neutral) and expected-move headline",
        "Macro context (consensus estimate + last value), SPX positioning (gamma regime, spot, flip distance), HELIX flow skew, prior-print history (actual vs estimate + SPX session/60min reaction)",
      ],
      cadence: "Polls faster the closer the event is — 10s within 1h, out to 5min beyond 72h",
      consume: "Read the prior-prints history before the outlook lean — a lean with a poor track record on this exact release type deserves less weight.",
    },
    {
      name: "Event detail — OpEx",
      location: "Right pane — OpEx events",
      purpose: "Pin-accuracy read for an options-expiration date.",
      shows: [
        "OpEx pin-accuracy headline and cross-market prior-OpEx table: Date / SPX / QQQ / SPY / Mag 7 / Top movers",
        "SPX structure (gamma regime, max pain), expiry pin & flow read",
      ],
      cadence: "Same proximity-scaled polling as macro events",
      consume: "The cross-market table shows whether prior OpEx dates actually pinned max pain or missed it — a real track record, not a prediction.",
    },
    {
      name: "Event detail — FDA",
      location: "Right pane — FDA events",
      purpose: "Decision-window context for an FDA date (PDUFA and similar).",
      shows: ["Drug/indication and decision window", "Ticker's gamma regime and spot positioning", "Insider filings and congress trades (when either has rows)", "Catalyst headlines"],
      cadence: "Same proximity-scaled polling as macro events",
      consume: "FDA events carry binary-outcome risk options structure doesn't fully price the same way earnings does — treat the positioning read as context, not a directional signal.",
    },
    {
      name: "Earnings sub-desk (5 tabs)",
      location: "Right pane — earnings events",
      purpose: "The deepest Meridian workflow: five tabs walking from decision-ready summary to full historical record.",
      shows: [
        "Summary: bull/bear-lean headline, an \"inputs used\" checklist, and two structure-framed idea cards (one call read, one put read) with implied probability, historical base rate, and an invalidation level",
        "Report: a 5-dimension conviction read (halo verdict, expected-move rail, dimension rings you can drill into) plus dealer-structure and flow visualizations",
        "Estimates: EPS/revenue trajectory vs consensus, year-over-year bars, analyst revision momentum, and price targets vs spot",
        "Positioning: dealer structure and strike profile for the print, dark pool tape, options flow into the print, plus sector-peer comparison and cross-desk intel (Thermal king nodes, Vector structure, Night Hawk board status, HELIX flow, SPX desk read)",
        "History: implied move vs realized reaction on settled prints only, beat-rate bars, and the full print-by-print track",
      ],
      actions: ["Switch tabs (Summary / Report / Estimates / Positioning / History)"],
      cadence: "Same proximity-scaled polling as other event kinds; auto-jumps to Estimates the moment actual EPS lands",
      consume:
        "Summary answers \"so what do I do?\" first — start there. Every idea card is explicitly labeled structure framing, not a trade recommendation. History's implied-vs-realized comparison only uses settled reactions — prints still forming are excluded and the excluded count is stated, never silently dropped.",
      tip: "A persistent warning banner appears if the earnings calendar feed didn't respond for a print — estimates and history go unavailable for that refresh, but everything else on the page stays live.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "One timeline endpoint serves all four catalyst kinds; selecting an event fetches its own detail payload, polled faster the closer the event is to firing.",
    ],
    features: [
      { title: "Four kinds, one rail", body: "Earnings, macro, OpEx, and FDA share the same timeline and filter model instead of four separate calendars." },
      { title: "Timing-aware reactions", body: "A print's reaction is anchored to whether it landed before the bell or after the close — never a raw same-day move that can invert the read." },
      { title: "Earnings gets the deepest workflow", body: "Five tabs vs a single detail card for the other three kinds — reflecting real product depth, not an oversight." },
      { title: "Cross-desk evidence, not isolated", body: "The Positioning tab pulls Thermal, Vector, HELIX, and Night Hawk context into the same read." },
    ],
  },
  usage: {
    intro: "Filter to what matters before scanning the whole window.",
    steps: [
      { title: "Filter or search", body: "Chip-filter by kind, or search a specific ticker/name." },
      { title: "Scan by month", body: "The timeline groups by month — look for clusters near your board or watchlist." },
      { title: "Open an event", body: "Click a row — the detail panel matches its kind automatically." },
      { title: "For earnings, start on Summary", body: "Read the idea cards and inputs-used checklist before drilling into Report/Estimates/Positioning/History." },
      { title: "Cross-check Positioning", body: "For earnings, confirm the dealer-structure read against Thermal/Vector before sizing." },
    ],
  },
  crossLinks: [
    CROSS.thermal("King-node and wall context cited on the earnings Positioning tab."),
    CROSS.vector("Cross-ticker structure read cited alongside Meridian's own positioning tab."),
    CROSS.helix("Flow skew and options-flow-into-print evidence."),
    CROSS.hawk("Board status shown inline when a Meridian ticker is on your Night Hawk board."),
    CROSS.largo("Ask follow-up questions about any catalyst's structure and history."),
  ],
  dos: [
    "Filter by kind before scanning a multi-week window.",
    "Start earnings events on Summary, not Report or Estimates.",
    "Check History's settled-reaction count before trusting an implied-vs-realized comparison.",
    "Cross-check the Positioning tab's dealer structure against Thermal/Vector.",
  ],
  donts: [
    "Don't treat Meridian as earnings-only — macro, OpEx, and FDA are real, separately filterable catalyst kinds.",
    "Don't read a same-day move as \"the reaction\" without checking the print's BMO/AMC timing classification.",
    "Don't treat the Summary idea cards as trade recommendations — they're explicitly structure framing.",
  ],
  faq: [
    { q: "Is Meridian just an earnings calendar?", a: "No — it's a catalyst timeline covering earnings, macro releases, OpEx, and FDA decisions. Earnings gets the deepest workflow (five tabs) because it carries the most product depth, not because it's the only kind covered." },
    { q: "Why does a print's reaction sometimes look inverted from what I'd expect?", a: "A post-close print's real reaction is the NEXT session, not the report date's own session (which is drift before the numbers were public). Meridian classifies each print's timing and anchors the reaction accordingly." },
    { q: "What's the difference between the Positioning tab's sector-peer panel and the Estimates tab?", a: "Estimates covers this ticker's own EPS/revenue trajectory and price targets. Positioning's peer panel ranks this ticker's implied move against OTHER names printing in the same window — a relative read, not this ticker's own numbers." },
  ],
});
