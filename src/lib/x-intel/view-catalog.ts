import type { XIntelSurface } from "@/lib/x-intel/queue-types";

/**
 * THE SURFACE VIEW CATALOG — every distinct thing on the platform worth photographing.
 *
 * ⚠️ PROVISIONAL. The operator is supplying worked capture exemplars per product, and those will
 * be matched EXACTLY — same surface, same framing, same crop, same state. Until they land, every
 * framing decision below is a placeholder. Conforming later must be an edit to THIS TABLE, not a
 * rewrite of the pipeline; if matching an exemplar ever requires changing pipeline code, the table
 * is in the wrong place and that is the bug to fix first.
 *
 * ── WHY THIS IS A CATALOG OF VIEWS, NOT A RECIPE PER PRODUCT ───────────────────────────────────
 *
 * The obvious design — one entry per product, one canonical shot each — is the design the content
 * spec explicitly forbids:
 *
 * > "Do not use the same predefined screenshots repeatedly."
 * > "Browse BLACKOUT like a curious expert human, not a screenshot automation script."
 *
 * A per-product recipe produces a feed of seven images on rotation, and a reader learns nothing
 * about the platform's depth. So the granularity here is the VIEW — Thermal Matrix and Thermal
 * Profile and Thermal Shift are three entries, not one — and the pipeline SELECTS among them per
 * story, penalising anything used recently (see `visual-memory.ts`).
 *
 * The table therefore holds what is STABLE (which views exist, where they live, how to reach one,
 * what must be true before the shutter fires) and leaves what is PER-STORY (which view best proves
 * THIS claim) to selection. That is the reconciliation between "keep framing in one config table"
 * and "explore like a human": the table is the map, not the itinerary.
 *
 * ── EVERY ENTRY MUST BE REACHABLE AND VERIFIABLE ───────────────────────────────────────────────
 *
 * `verify` is the precondition that must hold before capturing — the property that distinguishes
 * "the panel rendered with this story's data" from "the panel rendered". Without it a harness
 * screenshots loading skeletons, stale states and empty tables and reports success, which is the
 * exact list of rejects the content spec calls out. An entry with no meaningful `verify` is an
 * entry that will eventually publish a blank.
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
};

/**
 * Provisional catalog. Derived from `x-post-capture-playbook.ts` (the existing per-surface operator
 * instructions, which carry the real selectors) plus the view list in the operator's content spec.
 *
 * The playbook and `scripts/x-showcase-post.mjs` currently hold the same selectors in two places —
 * a hand-duplicated set across a `.ts` and a `.mjs`, which is a drift bug waiting for a UI change.
 * Unifying all three into this table is step 3 of the lane build order.
 */
export const X_INTEL_VIEW_CATALOG: ReadonlyArray<XIntelViewDef> = [
  // ── HELIX ──────────────────────────────────────────────────────────────────────────────────
  {
    id: "helix.live_flow",
    surface: "helix",
    label: "Helix live flow tape",
    path: "/flows",
    visualization: "tape",
    reach: [
      "Dismiss any onboarding overlay.",
      "Set Symbol via #helix-ticker-search to the story ticker (uppercase), then blur.",
      "Scroll so 3–8 recent prints are visible with premiums and strikes.",
    ],
    verify: "every visible row's symbol matches the story ticker; an empty state is captured honestly, never as a full tape",
    frame: "the flow tape panel only — premiums and strikes legible at timeline size",
    rth_only: true,
  },
  {
    id: "helix.contract_detail",
    surface: "helix",
    label: "Helix contract detail",
    path: "/flows",
    visualization: "contract_detail",
    reach: ["Open the specific contract the story is about from the tape."],
    verify: "the detail panel names the exact contract cited in the post copy",
    frame: "contract identity, premium and fill history together in one frame",
    rth_only: true,
  },
  {
    id: "helix.sector_rotation",
    surface: "helix",
    label: "Helix sector rotation",
    path: "/flows",
    visualization: "sector_rotation",
    reach: ["Open the sector rotation view."],
    verify: "sector rows populated with non-zero premium",
    frame: "the rotation ranking — leaders and laggards visible together",
    rth_only: true,
  },
  {
    id: "helix.dark_pool",
    surface: "helix",
    label: "Helix dark pool",
    path: "/flows",
    visualization: "dark_pool",
    reach: ["Open the dark pool view and filter to the story ticker."],
    verify: "prints listed for the story ticker",
    frame: "the dark pool prints with size and level",
    rth_only: true,
  },

  // ── THERMAL ────────────────────────────────────────────────────────────────────────────────
  {
    id: "thermal.matrix",
    surface: "thermal",
    label: "Thermal GEX matrix",
    path: "/heatmap",
    visualization: "matrix",
    reach: [
      "Change ticker via the combobox to the story ticker.",
      "Select the GEX lens (default).",
    ],
    verify: "matrix cells populated — no NO OPTIONS CHAIN state; spot row, flip line and at least one wall label visible",
    frame: "the full matrix plus the key-levels rail",
    rth_only: false,
  },
  {
    id: "thermal.profile",
    surface: "thermal",
    label: "Thermal gamma profile",
    path: "/heatmap",
    visualization: "profile",
    reach: ["Switch to the Profile view for the story ticker."],
    verify: "the profile curve renders with the spot marker placed",
    frame: "the curve with the level the story is about labelled",
    rth_only: false,
  },
  {
    id: "thermal.shift",
    surface: "thermal",
    label: "Thermal positioning shift",
    path: "/heatmap",
    visualization: "shift",
    reach: ["Switch to the Shift view for the story ticker."],
    verify: "a from/to comparison is rendered — a shift view with one state is not a shift",
    frame: "the change itself, both states legible",
    rth_only: true,
  },
  {
    id: "thermal.dealer_positioning",
    surface: "thermal",
    label: "Thermal dealer positioning",
    path: "/heatmap",
    visualization: "dealer",
    reach: ["Select the VEX or DEX lens as the story requires."],
    verify: "the selected lens is reflected in the active chip, not assumed",
    frame: "dealer exposure across strikes with the story's level in frame",
    rth_only: false,
  },
  {
    id: "thermal.compare_grid",
    surface: "thermal",
    label: "Thermal compare grid",
    path: "/heatmap",
    visualization: "compare_grid",
    reach: ["Enable Grid, then pick the sector preset the story is about."],
    verify: "every column in the preset has finished loading — a half-loaded grid is a stale frame",
    frame: "all columns in one frame",
    rth_only: false,
  },

  // ── VECTOR ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "vector.chart",
    surface: "vector",
    label: "Vector structure chart",
    path: "/vector",
    visualization: "chart",
    reach: [
      "Open with ?ticker= the story ticker.",
      "Select the horizon and timeframe that make the move legible — the timeframe is a per-story choice, not a fixed default.",
    ],
    verify: "candles rendered, active ticker matches, wall beads and the flip line settled",
    frame: "the chart wrap only — the move and the level in the same frame",
    rth_only: false,
  },
  {
    id: "vector.levels",
    surface: "vector",
    label: "Vector levels rail",
    path: "/vector",
    visualization: "levels",
    reach: ["Open the levels rail for the story ticker."],
    verify: "levels listed with values, not placeholders",
    frame: "the level the story cites, in context with its neighbours",
    rth_only: false,
  },
  {
    id: "vector.overlays",
    surface: "vector",
    label: "Vector chart with overlays",
    path: "/vector",
    visualization: "overlays",
    reach: ["Enable the overlay the story depends on."],
    verify: "the overlay is visibly drawn, not merely toggled on",
    frame: "overlay and price together — an overlay with no price context proves nothing",
    rth_only: false,
  },

  // ── SPX SLAYER ─────────────────────────────────────────────────────────────────────────────
  {
    id: "spx_slayer.desk",
    surface: "spx_slayer",
    label: "SPX Slayer desk",
    path: "/dashboard",
    visualization: "desk",
    reach: ["Wait for the play engine and the SPX GEX matrix rail."],
    verify: "phase, grade and gates rendered, and the live SPX spot row visible in the ladder",
    frame: "matrix rail and play engine in one frame",
    rth_only: true,
    spx_only: true,
  },

  // ── NIGHT HAWK ─────────────────────────────────────────────────────────────────────────────
  {
    id: "nighthawk.queue",
    surface: "nighthawk",
    label: "Night Hawk queue",
    path: "/nighthawk",
    visualization: "queue",
    reach: ["Open the 0DTE Command board."],
    verify: "play cards loaded, or the empty state captured honestly as an empty state",
    frame: "the queue with directions and strikes legible",
    rth_only: true,
  },
  {
    id: "nighthawk.thesis",
    surface: "nighthawk",
    label: "Night Hawk thesis",
    path: "/nighthawk",
    visualization: "thesis",
    reach: ["Open the play for the story ticker and its Thesis view."],
    verify: "the thesis text belongs to the cited play, not a neighbouring card",
    frame: "the reasoning, readable without zooming",
    rth_only: false,
  },
  {
    id: "nighthawk.management",
    surface: "nighthawk",
    label: "Night Hawk management",
    path: "/nighthawk",
    visualization: "management",
    reach: ["Open the play's Management view."],
    verify: "management state matches the status claimed in the post",
    frame: "trims, stops and current state together",
    rth_only: true,
  },
  {
    id: "nighthawk.pnl",
    surface: "nighthawk",
    label: "Night Hawk P&L",
    path: "/nighthawk",
    visualization: "pnl",
    reach: ["Expand the play row so entry, direction and live P&L are visible."],
    verify: "the P&L shown is the one quoted in the post copy — a moving number must be captured and quoted from the same instant",
    frame: "the single play card, not the whole board",
    rth_only: true,
  },
  {
    id: "nighthawk.timeline",
    surface: "nighthawk",
    label: "Night Hawk timeline",
    path: "/nighthawk",
    visualization: "timeline",
    reach: ["Open the play's Timeline view."],
    verify: "timestamps rendered — the timeline is the evidence, so a timeline with no times is worthless",
    frame: "fire time through current state, timestamps legible",
    rth_only: false,
  },

  // ── MERIDIAN ───────────────────────────────────────────────────────────────────────────────
  {
    id: "meridian.earnings",
    surface: "meridian",
    label: "Meridian earnings detail",
    path: "/meridian",
    visualization: "earnings",
    reach: [
      "Search the story ticker and open its event row — the timeline mixes macro/FDA/OpEx rows, so select by the earnings row specifically.",
    ],
    verify: "the event detail matches the searched ticker and the hero has populated",
    frame: "verdict and the cited numbers together",
    rth_only: false,
  },
  {
    id: "meridian.estimates",
    surface: "meridian",
    label: "Meridian estimates",
    path: "/meridian",
    visualization: "estimates",
    reach: ["Open the Estimates view on the event."],
    verify: "estimate values present, not dashes",
    frame: "the estimate and its history",
    rth_only: false,
  },
  {
    id: "meridian.positioning",
    surface: "meridian",
    label: "Meridian positioning",
    path: "/meridian",
    visualization: "positioning",
    reach: ["Open the positioning pillars on the event."],
    verify: "flow, thermal and dark pool pillars populated — an unfilled pillar must not read as a neutral one",
    frame: "the pillars together with the expected move",
    rth_only: false,
  },
  {
    id: "meridian.history",
    surface: "meridian",
    label: "Meridian reaction history",
    path: "/meridian",
    visualization: "history",
    reach: ["Open the historical reactions for the ticker."],
    verify: "prior reactions listed with dates and their basis — a reaction with no basis label is not citable",
    frame: "the history rows with their dates",
    rth_only: false,
  },

  // ── LARGO ──────────────────────────────────────────────────────────────────────────────────
  {
    id: "largo.answer",
    surface: "largo",
    label: "Largo cross-product answer",
    path: "/terminal",
    visualization: "answer",
    reach: ["Ask the question the story is about and wait for the full answer."],
    verify: "the assistant turn is COMPLETE, not mid-stream",
    frame: "the answer card including its levels rail",
    rth_only: false,
  },
];

export const X_INTEL_VIEW_BY_ID: Readonly<Record<string, XIntelViewDef>> = Object.fromEntries(
  X_INTEL_VIEW_CATALOG.map((v) => [v.id, v]),
);

/** Views on a given surface — the candidate set when a story needs that surface's evidence. */
export function viewsForSurface(surface: XIntelViewDef["surface"]): XIntelViewDef[] {
  return X_INTEL_VIEW_CATALOG.filter((v) => v.surface === surface);
}
