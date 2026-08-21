import type { XIntelSurface } from "@/lib/x-intel/queue-types";

/**
 * THE SURFACE VIEW CATALOG — every distinct thing on the platform worth photographing.
 *
 * ⚠️ Framing notes below are PROVISIONAL where the operator has not yet ruled. Where they HAVE
 * ruled (Thermal, Helix, Vector, SPX Slayer — 2026-08-21) the rule is recorded verbatim in
 * `operator_rule` and must be matched exactly, not approximately.
 *
 * ── THE FIVE STANDING RULES FROM THE OPERATOR'S EXEMPLARS (2026-08-21) ─────────────────────────
 *
 * 1. PRODUCT INTERFACE ONLY. No marketing header — no "Open desk" CTA, no Features/FAQ/Learn nav.
 *    Frame on the desk container, never the page.
 *
 * 2. THERMAL IS ALWAYS THE **ALL** EXPIRY FILTER. Lens is free (GEX/VEX/DEX/CHARM); the expiry
 *    scope is not. This is a CORRECTNESS rule, not a framing preference: `GexHeatmap.tsx` defaults
 *    the scope to the FRONT expiry (`scopeResolvedRef` → `expiries[0]`), and the front expiry
 *    reads a different regime from the whole book. Measured on 2026-08-21: AUG 21 alone showed
 *    `LONG GAMMA · NET GEX -$1.8B`, while ALL showed `SHORT GAMMA at EVERY strike · NET GEX
 *    -$7.6B`. A post built on the default would have told readers dealers were dampening
 *    volatility on a day the book says they amplify it.
 *
 * 3. CHARTS MUST BE ZOOMED AND SCROLLED IN. Individual candles, gamma beads and wall bands have to
 *    be legible. The default page-load fit is "how the page loads", not evidence of a move.
 *
 * 4. USE THE BIG MODES. Full screen and compare/grid are first-class captures, not fallbacks —
 *    Vector COMPARE (4 charts, MAG 7 / INDICES / SEMIS / MOMENTUM) and Thermal GRID (ten sector
 *    presets) are among the strongest frames the platform can produce.
 *
 * 5. ALWAYS UNIQUE. Different tabs, panels, filters and sectors per post. The feed must show as
 *    much of the platform as possible over time — enforced by `visual-memory.ts`, which is the
 *    machinery behind this rule rather than a restatement of it.
 */

export type XIntelViewId = string;

export type XIntelViewDef = {
  id: XIntelViewId;
  surface: XIntelSurface | "track_record";
  /** Human name, as it would be described in an attachment caption. */
  label: string;
  /** Route, relative. Must be allowlisted by `capture-guard.ts` — that check is authoritative. */
  path: string;
  /** Which visualization this is: what makes it different from its siblings on the same route. */
  visualization: string;
  /**
   * How to reach it from a fresh page load. Prose, because the operator's exemplars are prose and
   * matching them should be an edit here rather than a code change. Derived from
   * `src/lib/largo/x-post-capture-playbook.ts`, which encodes the same steps for a human operator.
   */
  reach: string[];
  /** The precondition. See the header — an entry without a real one will publish a blank. */
  verify: string;
  /** What the frame should contain. The crop is judged against this, not against a pixel box. */
  frame: string;
  /** True when the view only carries meaning during RTH (live chains, live tape, live P&L). */
  rth_only: boolean;
  /** True when the view is SPX-only and must not be selected for a single-name story. */
  spx_only?: boolean;
  /**
   * A rule the operator stated directly about this view. Where present it is binding and must be
   * matched exactly — "close enough" on a house style is a decision they did not make.
   */
  operator_rule?: string;
};

/**
 * Provisional catalog. Derived from `x-post-capture-playbook.ts` (the existing per-surface operator
 * instructions, which carry the real selectors) plus the view list in the operator's content spec.
 *
 * The playbook and `scripts/x-showcase-post.mjs` currently hold the same selectors in two places —
 * a hand-duplicated set across a `.ts` and a `.mjs`, which is a drift bug waiting for a UI change.
 * Unifying all three into this table is step 3 of the lane build order.
 */
/** Operator rule 2 — the expiry scope is a correctness constraint, not a framing preference. */
const ALL_EXPIRY_RULE =
  "EXPIRY = ALL, always. Set it on the MATRIX view BEFORE switching tabs — FORCED FLOW renders no expiry bar at all. Lens is free (GEX/VEX/DEX/CHARM); expiry scope is not.";

/** Operator rule 3 — a chart at its default fit is not evidence of a move. */
const ZOOM_RULE =
  "Zoom and scroll in until individual candles, gamma beads and wall bands are legible. The default page-load fit is not acceptable.";

export const X_INTEL_VIEW_CATALOG: ReadonlyArray<XIntelViewDef> = [
  // ── THERMAL — operator exemplars 2026-08-21 ───────────────────────────────────────────────
  {
    id: "thermal.matrix", surface: "thermal", label: "Thermal dealer-gamma matrix",
    path: "/heatmap", visualization: "matrix",
    reach: ["Set the story ticker.", "Click EXPIRY **All**.", "Pick the lens (GEX default).", "Frame `.gex-heatmap-desk`."],
    verify: "the All chip reads aria-pressed=true AND the THERMAL STATE strip rendered — assert both, never assume",
    frame: "ticker/spot bar → THERMAL STATE strip → full multi-expiry matrix. No marketing nav.",
    rth_only: false, operator_rule: ALL_EXPIRY_RULE,
  },
  {
    id: "thermal.gamma_profile", surface: "thermal", label: "Thermal gamma profile + curve + shift",
    path: "/heatmap", visualization: "profile_curve_shift",
    reach: ["Set EXPIRY **All** on MATRIX first.", "Then open GAMMA PROFILE + CURVE + SHIFT."],
    verify: "gamma intensity rail populated and the cumulative curve has drawn its zero-crossing",
    frame: "intensity rail + cumulative curve + intraday shift panel together",
    rth_only: false, operator_rule: ALL_EXPIRY_RULE,
  },
  {
    id: "thermal.forced_flow", surface: "thermal", label: "Thermal forced dealer flow (depth)",
    path: "/heatmap", visualization: "forced_flow",
    reach: ["Set EXPIRY **All** on MATRIX first.", "Then open FORCED FLOW (DEPTH)."],
    verify: "the SPOT divider is drawn with bars on both sides and the CALL WALL / PUT WALL annotations placed",
    frame: "THERMAL STATE strip + the full ladder including the buy/sell legend and the modelled-flip caption",
    rth_only: false,
    operator_rule: "No expiry bar exists on this view — it is inherently near-term. Set ALL on MATRIX first; do not look for the chip here.",
  },
  {
    id: "thermal.sector_grid", surface: "thermal", label: "Thermal sector compare grid",
    path: "/heatmap", visualization: "compare_grid",
    reach: ["Toggle GRID on.", "Pick a sector preset.", "Wait for EVERY column to finish loading."],
    verify: "every ticker column has cells — a half-loaded grid is a stale frame, not a fast one",
    frame: "all columns in one frame",
    rth_only: false,
    operator_rule: "Rotate the preset: Indices · Macro · Semis · AI · Space · Mag 7 · Crypto · Energy · Financials · Healthcare. Ten presets is ten distinct frames — do not keep returning to one.",
  },

  // ── VECTOR — operator exemplars 2026-08-21 ────────────────────────────────────────────────
  {
    id: "vector.desk", surface: "vector", label: "Vector desk — matrix rail + chart + intel rail",
    path: "/vector", visualization: "desk",
    reach: ["Open with ?ticker=.", "Pick horizon and timeframe.", "Zoom the chart in.", "Move the pointer OFF the chart so the crosshair tooltip clears."],
    verify: "candles rendered, beads settled, and the intel rail populated",
    frame: "0DTE matrix rail + zoomed chart + right intel rail (Live Helix / scalp read / technicals)",
    rth_only: false, operator_rule: ZOOM_RULE,
  },
  {
    id: "vector.fullscreen", surface: "vector", label: "Vector full-screen chart",
    path: "/vector", visualization: "fullscreen_chart",
    reach: ["Open with ?ticker=.", "Click FULL SCREEN.", "Zoom to the window the story is about."],
    verify: "the toolbar reads EXIT FULL SCREEN — otherwise full screen did not engage",
    frame: "toolbar + chart + volume pane, edge to edge",
    rth_only: false, operator_rule: ZOOM_RULE,
  },
  {
    id: "vector.compare", surface: "vector", label: "Vector compare — 4 charts",
    path: "/vector", visualization: "compare_4up",
    reach: ["Click COMPARE.", "Pick a preset: MAG 7 / INDICES / SEMIS / MOMENTUM.", "Let all four panes load."],
    verify: "all four panes have candles — one empty pane makes the frame read as broken",
    frame: "the 2x2 grid with each pane's ticker and last price legible",
    rth_only: false,
    operator_rule: "Compare is a first-class capture, not a fallback. Rotate the preset per post.",
  },

  // ── HELIX — operator exemplars 2026-08-21 ─────────────────────────────────────────────────
  {
    id: "helix.tape", surface: "helix", label: "Helix flow tape",
    path: "/flows", visualization: "tape",
    reach: ["Set SYMBOL to the story ticker.", "Choose FLOOR / SIDE / DTE to suit the story.", "Scroll so the cited prints are in frame."],
    verify: "every visible row's SYM matches the story ticker; an empty tape is captured honestly as empty",
    frame: "HELIX header + filter row + print table through the INTEL column",
    rth_only: true,
    operator_rule: "Vary the filters per post — FLOOR $200K/$500K/$1M/$20M, SIDE ALL/CALL/PUT, DTE ALL/0DTE/≤7D/>7D, QUICK WHALES/0DTE/INDICES. The filter row is visible in frame, so it is part of the evidence.",
  },
  {
    id: "helix.top_prints", surface: "helix", label: "Helix conviction — top prints",
    path: "/flows", visualization: "top_prints",
    reach: ["Open ANALYTICS → TOP PRINTS."],
    verify: "scored print cards rendered with premium and aggressor per row",
    frame: "the scored card stack",
    rth_only: true,
  },
  {
    id: "helix.top_strikes", surface: "helix", label: "Helix top strikes — repeated flow",
    path: "/flows", visualization: "top_strikes",
    reach: ["Open ANALYTICS → TOP STRIKES (same contract, rolling window)."],
    verify: "cards show REPEAT + STACK with a window total and a tape count",
    frame: "the strike cards with side, expiry and window notional",
    rth_only: true,
    operator_rule: "This is the strongest WHALE WATCH evidence — repetition and direction, not one sweep.",
  },
  {
    id: "helix.analytics_panels", surface: "helix", label: "Helix all analytics panels",
    path: "/flows", visualization: "analytics_panels",
    reach: ["Open ANALYTICS → MORE PANELS."],
    verify: "the panel modal is open with its cards populated; an unfilled panel must read as unavailable, not as zero",
    frame: "the modal — Hawk conviction, split-flow radar, route breakdown, signal outcomes",
    rth_only: true,
  },
  {
    id: "helix.contract_drilldown", surface: "helix", label: "Helix contract drilldown",
    path: "/flows", visualization: "contract_drilldown",
    reach: ["Click the specific print the story cites to open CONTRACT DRILLDOWN."],
    verify: "the drilldown names the exact contract quoted in the post copy",
    frame: "THIS PRINT stats + contract activity + intraday volume chart",
    rth_only: true,
  },

  // ── SPX SLAYER — operator exemplars 2026-08-21 ────────────────────────────────────────────
  {
    id: "spx_slayer.desk", surface: "spx_slayer", label: "SPX Slayer desk",
    path: "/dashboard", visualization: "desk",
    reach: ["Wait for the header stat row, the dealer gamma map and the pin forecaster."],
    verify: "the header stats row carries live values (SPX, VIX, VWAP, GEX, FLIP, MAX PAIN, IV RANK) — a dash row means it has not hydrated",
    frame: "header stats + PULSE + gamma map + pin forecaster + chart",
    rth_only: true, spx_only: true,
  },
  {
    id: "spx_slayer.pin_forecaster", surface: "spx_slayer", label: "EOD pin forecaster",
    path: "/dashboard", visualization: "pin_forecaster",
    reach: ["Open the EOD PIN FORECASTER.", "Click **Why this pin? →** so the reasoning is in frame."],
    verify: "projected close, pin confidence and dominant magnet all carry values",
    frame: "the drift cone + projected close + confidence + WHY THIS PIN reasoning",
    rth_only: true, spx_only: true,
    operator_rule: "Expand WHY THIS PIN — the reasoning is the evidence, not the cone.",
  },
  {
    id: "spx_slayer.largo_read", surface: "spx_slayer", label: "Largo live commentary",
    path: "/dashboard", visualization: "largo_commentary",
    reach: ["Open the LARGO tab on the left rail."],
    verify: "the commentary carries a timestamp and a stance; a NEUTRAL/WAIT read is captured as-is",
    frame: "stance + triggers + levels to watch",
    rth_only: true, spx_only: true,
    operator_rule: "A NEUTRAL / WAIT read is publishable content, not a failed capture — see the contrarian exemplar.",
  },

  // ── NIGHT HAWK ────────────────────────────────────────────────────────────────────────────
  {
    id: "nighthawk.queue", surface: "nighthawk", label: "Night Hawk 0DTE board",
    path: "/nighthawk", visualization: "queue",
    reach: ["Open the 0DTE Command board."],
    verify: "play cards loaded, or the empty state captured honestly as empty",
    frame: "the board with directions and strikes legible", rth_only: true,
  },
  {
    id: "nighthawk.thesis", surface: "nighthawk", label: "Night Hawk thesis",
    path: "/nighthawk", visualization: "thesis",
    reach: ["Open the play for the story ticker, then its Thesis view."],
    verify: "the thesis belongs to the cited play, not a neighbouring card",
    frame: "the reasoning, readable without zooming", rth_only: false,
  },
  {
    id: "nighthawk.management", surface: "nighthawk", label: "Night Hawk management",
    path: "/nighthawk", visualization: "management",
    reach: ["Open the play's Management view."],
    verify: "management state matches the status claimed in the post",
    frame: "trims, stops and current state together", rth_only: true,
  },
  {
    id: "nighthawk.pnl", surface: "nighthawk", label: "Night Hawk P&L",
    path: "/nighthawk", visualization: "pnl",
    reach: ["Expand the play row so entry, direction and live P&L show."],
    verify: "the P&L shown is the one quoted in the post — a moving number must be captured and quoted from the same instant",
    frame: "the single play card, not the whole board", rth_only: true,
  },
  {
    id: "nighthawk.timeline", surface: "nighthawk", label: "Night Hawk timeline",
    path: "/nighthawk", visualization: "timeline",
    reach: ["Open the play's Timeline view."],
    verify: "timestamps rendered — a timeline with no times is worthless as evidence",
    frame: "fire time through current state", rth_only: false,
  },

  // ── MERIDIAN ──────────────────────────────────────────────────────────────────────────────
  {
    id: "meridian.earnings", surface: "meridian", label: "Meridian earnings detail",
    path: "/meridian", visualization: "earnings",
    reach: ["Search the ticker; open its EARNINGS row specifically — the timeline mixes macro/FDA/OpEx rows."],
    verify: "the detail matches the searched ticker and the hero has populated",
    frame: "verdict and the cited numbers together", rth_only: false,
  },
  {
    id: "meridian.estimates", surface: "meridian", label: "Meridian estimates",
    path: "/meridian", visualization: "estimates",
    reach: ["Open Estimates on the event."],
    verify: "estimate values present, not dashes",
    frame: "the estimate and its history", rth_only: false,
  },
  {
    id: "meridian.positioning", surface: "meridian", label: "Meridian positioning",
    path: "/meridian", visualization: "positioning",
    reach: ["Open the positioning pillars."],
    verify: "flow, thermal and dark pool pillars populated — an unfilled pillar must not read as neutral",
    frame: "the pillars with the expected move", rth_only: false,
  },
  {
    id: "meridian.history", surface: "meridian", label: "Meridian reaction history",
    path: "/meridian", visualization: "history",
    reach: ["Open historical reactions."],
    verify: "prior reactions listed with dates and basis — a reaction with no basis label is not citable",
    frame: "the history rows with dates", rth_only: false,
  },

  // ── LARGO ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "largo.answer", surface: "largo", label: "Largo cross-product answer",
    path: "/terminal", visualization: "answer",
    reach: ["Ask the question the story is about; wait for the full answer."],
    verify: "the assistant turn is COMPLETE, not mid-stream",
    frame: "the answer card including its levels rail", rth_only: false,
  },
];

export const X_INTEL_VIEW_BY_ID: Readonly<Record<string, XIntelViewDef>> = Object.fromEntries(
  X_INTEL_VIEW_CATALOG.map((v) => [v.id, v]),
);

/** Views on a given surface — the candidate set when a story needs that surface's evidence. */
export function viewsForSurface(surface: XIntelViewDef["surface"]): XIntelViewDef[] {
  return X_INTEL_VIEW_CATALOG.filter((v) => v.surface === surface);
}
