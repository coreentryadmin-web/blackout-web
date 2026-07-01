import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const nightsWatchGuide = defineToolGuide({
  slug: "nights-watch",
  chapter: 7,
  title: "Night's Watch",
  description:
    "Personal options position manager — live P&L, Greeks, deterministic verdicts, and cross-tool intel on logged positions.",
  overview: [
    "Night's Watch tracks positions you log manually on-platform. It does not connect to your brokerage — you maintain the book.",
    "Hosted on `/nighthawk` right column alongside PlaybookBoard. Live chain pricing drives P&L and Greeks; valuation status (live / stale / unavailable) surfaces data quality.",
    "Verdict engine emits HOLD / TRIM / SELL / WATCH guidance based on structure, P&L, and coaching inputs — discipline aid, not auto-execution.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Right column on /nighthawk: collapsible sections stacked vertically — Portfolio Overview, Add position form, Open positions, Closed positions, Position coach, Personal play alerts.",
      "PositionCard grid in Open/Closed sections. Click any card for NightsWatchDetailModal — full cross-tool intel fetch.",
      "SSE position stream (~3s push when connected) plus REST poll fallback (5s RTH / 30s off-hours).",
    ],
  },
  panels: [
    {
      name: "Portfolio Overview",
      location: "Top section — collapsible",
      purpose: "Aggregate view of your open book: Greeks, premium at risk, verdict tallies.",
      shows: [
        "Net delta, gamma, theta, vega",
        "Premium at risk",
        "Open count, unrealized P&L, return %",
        "Verdict tallies (how many HOLD / TRIM / SELL / WATCH)",
      ],
      actions: ["Expand/collapse tile"],
      cadence: "SSE + poll same as positions",
      consume:
        "Start here after adding positions. Net gamma sign tells you if the book is vol-long or vol-short in aggregate. Verdict tallies surface how many legs need attention — drill into cards flagged SELL or TRIM first.",
    },
    {
      name: "Add position form",
      location: "Second section",
      purpose: "Manual entry for new legs — the book is only as accurate as you make it.",
      shows: [
        "Fields: ticker, call/put, long/short, strike, expiry, contracts, entry premium",
      ],
      actions: ["Submit Add position → POST /api/account/positions"],
      cadence: "On submit only",
      consume:
        "Log immediately on broker fill — Greeks and verdicts require current position data. Double-check long/short and entry premium; errors propagate to P&L and coaching.",
      tip: "If you scale in, add a new row or update — do not rely on mental math for average price.",
    },
    {
      name: "Open positions (PositionCard grid)",
      location: "Third section",
      purpose: "Live marks, per-leg Greeks, verdict chip, and quick actions.",
      shows: [
        "Per card: ticker, structure, unrealized P&L, return %",
        "Valuation status: live / stale / unavailable",
        "Greeks grid, verdict chip (HOLD/TRIM/SELL/WATCH), reason line",
      ],
      actions: [
        "Card click → NightsWatchDetailModal",
        "Full intel → detail modal",
        "Close → inline exit premium",
        "Delete → two-step confirm",
      ],
      cadence: "SSE ~3s + poll 5s RTH / 30s off-hours",
      consume:
        "Sort mentally by verdict urgency. Stale valuation means chain fetch delayed >30s — retry before trusting P&L. Close with exit premium when you flatten at broker. Reason line explains verdict — read before overriding.",
    },
    {
      name: "Closed positions",
      location: "Fourth section",
      purpose: "Historical book with realized P&L for review.",
      shows: [
        "Same card layout with realized P&L",
        "Entry/exit/closed dates",
      ],
      actions: ["Delete record", "Open detail for archived intel"],
      cadence: "On load and after mutations",
      consume:
        "Use for weekly review — compare realized outcomes to Night Hawk invalidation and Slayer stops. Delete duplicates from logging mistakes.",
    },
    {
      name: "Position coach",
      location: "Fifth section",
      purpose: "SPX structural coaching alerts when you hold SPX-family names.",
      shows: [
        "Urgency-tagged alerts with for-longs / for-shorts copy",
        "Wall, VWAP, and flip-relative guidance",
        "Explanatory copy when no SPX-family positions open",
      ],
      cadence: "30s poll + window focus via /api/coaching/alerts",
      consume:
        "Only active when book includes SPX-related legs. Alerts reference same walls as Slayer — use as exit nudge, not entry signal. If coach says trim into wall test, cross-check Thermal.",
    },
    {
      name: "Personal play alerts",
      location: "Bottom section",
      purpose: "Optional Discord webhook for personal notifications.",
      shows: ["Webhook host (redacted), configure/clear state"],
      actions: ["Save or clear Discord webhook URL"],
      cadence: "On user action",
      consume:
        "Optional — configure once if you want pushes off-platform. Does not replace in-app verdicts.",
    },
    {
      name: "NightsWatchDetailModal",
      location: "Center overlay — on card click",
      purpose: "Full cross-tool decision intel for one position.",
      shows: [
        "Verdict front-and-center",
        "Sections: positioning, flows, technicals, news, catalysts, confluence, dossier",
        "Verified source ledger (data provenance)",
      ],
      actions: ["Refresh manual re-fetch", "Close"],
      cadence: "Fetch once per open — no interval poll",
      consume:
        "Open before major size changes or holds into close. Refresh if you kept modal open through a fast market. Source ledger shows which APIs contributed — stale sections may lag others.",
      tip: "Largo get_my_positions reads the same book — ask Largo for narrative after reviewing modal intel.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "Positions stored per Clerk user. Pricing refreshed from options chain APIs. Verdict rules combine P&L thresholds, structure from GEX desk, and coaching cron output.",
    ],
    features: [
      { title: "Verdict engine", body: "HOLD / TRIM / SELL / WATCH from deterministic rules — not LLM guesses." },
      { title: "Live marks", body: "live / stale / unavailable states on every card." },
      { title: "Dual transport", body: "SSE stream with REST poll fallback for resilience." },
      { title: "Detail intel", body: "Modal aggregates multi-domain fetch once per open." },
    ],
  },
  usage: {
    intro: "Log every Slayer or Night Hawk trade immediately. Review coach + verdicts continuously.",
    steps: [
      { title: "Log on entry", body: "Accurate strike, expiry, contracts, entry premium." },
      { title: "Check valuation status", body: "Do not trust stale P&L for decisions." },
      { title: "Monitor verdict chip", body: "TRIM/SELL are action prompts — confirm with Slayer structure." },
      { title: "Open Full intel before hold into event", body: "Detail modal for catalyst and flow context." },
      { title: "Close when invalidation hits", body: "Align with Night Hawk / Slayer levels; record exit premium." },
    ],
  },
  crossLinks: [
    CROSS.spx("Play cards supply entry/stop/target references."),
    CROSS.hawk("Evening invalidation levels — same /nighthawk page."),
    CROSS.largo("get_my_positions for Q&A on your book."),
    CROSS.thermal("Confirm wall tests affecting SPX legs."),
  ],
  dos: [
    "Update size and strikes accurately.",
    "Check valuation status before trusting P&L.",
    "Use detail modal before ambiguous holds.",
    "Respond to position coach when holding SPX.",
  ],
  donts: [
    "Don't assume brokerage sync — manual book only.",
    "Don't ignore SELL verdict without reading reason line.",
    "Don't leave modal open through fast markets without refresh.",
  ],
  faq: [
    { q: "Why stale pricing?", a: "Chain fetch delayed >30s — retry or check market hours." },
    { q: "Does verdict auto-trade?", a: "No — guidance only; you execute at your broker." },
    { q: "Why on /nighthawk?", a: "Unified evening read + position management workflow." },
  ],
});
