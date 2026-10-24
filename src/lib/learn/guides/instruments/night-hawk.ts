import { defineToolGuide, CROSS } from "@/lib/learn/guides/shared";

export const nightHawkGuide = defineToolGuide({
  slug: "night-hawk",
  chapter: 5,
  title: "Night Hawk",
  description:
    "Evening Edition prep and pre-market confirmation — tomorrow's setups, GEX context, and invalidation levels published after the close.",
  overview: [
    "Night Hawk publishes the Evening Edition: market recap, catalyst scan, GEX positioning, ranked play ideas, and hard invalidation levels for the next session.",
    "Route `/nighthawk` hosts three views behind a single tab selector (ZERO_DTE / SWING / LEGACY, ?view= in the URL): the always-on intraday scanner, the Swing Command board, and this playbook (the Legacy tab). Only the selected view's data is fetched. This chapter covers the Legacy/playbook tab; 0DTE Command has its own guide.",
    "It is asynchronous preparation — not a live execution desk. SPX Slayer takes over at the open. Morning confirm cron updates CONFIRMED / DEGRADED / INVALIDATED badges on each play.",
  ],
  layout: {
    title: "Desk layout",
    paragraphs: [
      "Single tab-based view (ZERO_DTE / SWING / LEGACY) — the Legacy tab is a filterable, sortable pick-log TABLE (not a fixed column of ranked cards): a toolbar (tab counts, ticker search, status/tier/reason filters, sort, edition-date calendar), the play table itself, and a detail rail that slides in when you select a row (replaces the older center-overlay modal).",
      "Edition data refreshes on a slower cadence than Slayer — expect 120s SWR on edition, 60s on play-status/morning-confirm, 600s (10 min) on track record.",
      "If tonight's board is not published yet, stale/prior edition copy appears with explicit notice — read the freshness badges before trading old levels.",
    ],
  },
  panels: [
    {
      name: "Toolbar (tabs, search, filters, calendar)",
      location: "Top of the Legacy tab",
      purpose: "Tab/filter/sort control for the pick-log table, plus freshness/degraded/stale banners and the edition-date calendar for browsing prior editions.",
      shows: [
        "Tab counts (e.g. open/closed) and status/tier/reason filters",
        "Ticker search and column sort",
        "Freshness/degraded/stale/carry-forward banner when applicable",
        "Edition-date calendar to select a prior session's board",
        "Density/focus-mode prefs, CSV export, compare mode",
      ],
      cadence: "Edition 120s; morning-confirm 60s",
      consume:
        "Read the banner first — a stale/prior notice means you're looking at yesterday's board, validate every level at the open. Use the calendar to review a past edition's outcomes rather than assuming today's list.",
    },
    {
      name: "Track record scorecard",
      location: "Below the toolbar (hidden in focus mode or once a row is selected)",
      purpose: "Rolling track record for resolved Night Hawk plays, sourced from the same /api/market/nighthawk/record the per-conviction scorecard badges on each row read.",
      shows: [
        "Resolved-play counts and win-rate summary for the session/window",
        "Per-conviction win-rate badges surfaced on individual rows",
      ],
      cadence: "600s (10 min) via parent SWR",
      consume:
        "Use for calibration, not prediction. Low sample sizes should not be over-weighted early in a window. Pair with your own journal.",
    },
    {
      name: "Macro context strip",
      location: "Below the scorecard (only when macro context is available and no row is selected)",
      purpose: "End-of-day market snapshot carried into the edition: SPX premarket, overnight gap, regime, GEX bias, call/put walls.",
      shows: [
        "SPX premarket level and prior close",
        "Overnight gap (points)",
        "Regime read and GEX bias, call/put wall levels",
      ],
      cadence: "Updates with the morning-confirm payload",
      consume:
        "Sets the macro tone before you scan the table. Cross-check against live levels at the open if the overnight read looks extreme.",
    },
    {
      name: "Pick-log table",
      location: "Main body — sortable/filterable rows",
      purpose: "Every ranked setup for the selected tab/date, with conviction, levels, and morning status per row — replaces the older fixed five-card ranked list.",
      shows: [
        "Ticker, direction, conviction/tier, rank",
        "Morning status: Confirmed / Degraded / Invalidated",
        "Score, flow streak, IV, premium cap",
        "Live/at-risk row highlighting",
        "Per-row compare checkbox",
      ],
      actions: [
        "Click a row to open the detail rail",
        "Toggle a row into compare mode",
      ],
      cadence: "Edition refresh 120s; morning badges via play-status 60s",
      consume:
        "Work top-down by rank within a tab. Morning badges override yesterday's optimism — INVALIDATED means do not trade the setup without fresh Slayer confirmation. Use filters (status/tier/reason) rather than scrolling the full list once it's long.",
    },
    {
      name: "Detail rail (manage + technicals)",
      location: "Right-side rail (or a bottom sheet on mobile) — opens on row select",
      purpose: "Deep breakdown for one selected play: management state and technical context. Replaces the older center-overlay PlayDetailModal.",
      shows: [
        "Thesis, entry / target / stop, options contract, risk note",
        "Technical context for the selected ticker",
      ],
      actions: ["Close rail (or backdrop tap on mobile) to return to the table"],
      cadence: "Follows the selected row's own data — no separate poll",
      consume:
        "Open for your top-ranked ideas after scanning the table. Hard levels shown here still rule over any narrative context. Close and re-select if the edition refreshed mid-read.",
    },
  ],
  howItWorks: {
    paragraphs: [
      "After cash close, cron builds the edition from end-of-day chain, flow, and catalyst context. Pre-market morning confirm cron re-evaluates each play against overnight structure.",
    ],
    features: [
      { title: "Edition blocks", body: "Structured document: recap, context bar, five ranked rows, record strip." },
      { title: "Morning confirm", body: "CONFIRMED / DEGRADED / INVALIDATED badges reflect pre-open revalidation." },
      { title: "Carry logic", body: "Plays may persist across sessions until close or invalidation." },
      { title: "Shared route", body: "/nighthawk hosts three tabs on one route (ZERO_DTE / SWING / LEGACY) — switch views without a page navigation; each tab's data only loads while it's selected." },
    ],
  },
  usage: {
    intro: "Read after 4:30 PM ET. Validate at the open on Slayer — markets change overnight.",
    steps: [
      { title: "Read after close", body: "Bookmark edition cadence; expand recap once." },
      { title: "Note invalidation", body: "Carry hard levels into the pre-market open." },
      { title: "Check morning badges", body: "Before 9:30, refresh for CONFIRMED vs INVALIDATED." },
      { title: "Validate at open", body: "Slayer flip and walls may disagree — Slayer wins for execution." },
      { title: "Check 0DTE Command", body: "Switch to the ZERO_DTE tab on the same route to see today's always-on scanner finds." },
    ],
  },
  crossLinks: [
    CROSS.spx("Live execution desk for RTH."),
    CROSS.helix("Night Hawk Flow panel on HELIX links edition to live tape."),
    CROSS.largo("Ask get_nighthawk_edition for structured Q&A on the board."),
  ],
  dos: [
    "Use as bias, not autopilot.",
    "Re-read invalidation at the open.",
    "Respect INVALIDATED morning badges.",
    "Read Hawk Intel for context, not permission.",
  ],
  donts: [
    "Don't enter solely on yesterday's edition without open validation.",
    "Don't ignore stale/prior edition notices.",
    "Don't confuse Night Hawk with the play engine — different clocks and gates.",
  ],
  faq: [
    { q: "Night Hawk vs SPX Slayer?", a: "Night Hawk = evening publication + morning confirm; Slayer = live RTH engine with 3s play poll." },
    { q: "When is the edition published?", a: "After cash close via cron; empty slots show until complete (~evening ET)." },
    { q: "Why is 0DTE Command on the same page?", a: "Single workflow: switch between the evening playbook (LEGACY tab), Swing Command, and the always-on scanner (ZERO_DTE tab) without a route change." },
  ],
});
