/**
 * Registry of the price-pane overlay indicators the member can toggle on the Vector chart.
 * Most indicators default OFF; dealer gamma positioning (`gex-heatmap`) defaults ON — see
 * `VECTOR_DEFAULT_ENABLED_INDICATORS`. Each entry is pure config; the chart layer maps
 * `kind`+`period` to the matching `vector-indicators` series computer and draws a line in `color`.
 * Kept as data (not hard-coded in the component) so adding an overlay is a one-line change and the
 * toggle menu renders straight from this list.
 *
 * Two layers on purpose:
 *  - `VECTOR_OVERLAYS` — the concrete LINES the chart actually draws (EMA 9, EMA 21, …). Each line
 *    still gets its own series + colour.
 *  - `VECTOR_OVERLAY_FAMILIES` — the TOGGLE units the member sees. One toggle per TYPE (VWAP / EMA /
 *    SMA), so enabling "EMA" draws every EMA line at once instead of three separate checkboxes. The
 *    enabled Set holds family ids, and the chart draws a line iff its `family` is enabled. New types
 *    (DMA, volume/session profile, …) slot in as one more family with its member lines.
 */

export type VectorOverlayId = "vwap" | "ema9" | "ema21" | "ema50" | "sma50" | "sma200";

/** Overlay TYPE — the toggle unit. One family expands to all its member lines. */
export type VectorOverlayFamilyId = "vwap" | "ema" | "sma";

export type VectorOverlayDef = {
  id: VectorOverlayId;
  label: string;
  /** Which `vector-indicators` computer feeds this line. */
  kind: "vwap" | "ema" | "sma";
  /** Which toggle family this line belongs to — the chart draws it iff the family is enabled. */
  family: VectorOverlayFamilyId;
  /** Lookback for ema/sma; unused for vwap. */
  period?: number;
  /** Line colour — chosen distinct from the gold/purple beads and the cyan gamma-flip line. */
  color: string;
};

export const VECTOR_OVERLAYS: readonly VectorOverlayDef[] = [
  { id: "vwap", label: "VWAP", kind: "vwap", family: "vwap", color: "#60a5fa" },
  { id: "ema9", label: "EMA 9", kind: "ema", family: "ema", period: 9, color: "#fb923c" },
  { id: "ema21", label: "EMA 21", kind: "ema", family: "ema", period: 21, color: "#fbbf24" },
  { id: "ema50", label: "EMA 50", kind: "ema", family: "ema", period: 50, color: "#f472b6" },
  { id: "sma50", label: "SMA 50", kind: "sma", family: "sma", period: 50, color: "#2dd4bf" },
  { id: "sma200", label: "SMA 200", kind: "sma", family: "sma", period: 200, color: "#f87171" },
] as const;

const OVERLAY_IDS = new Set<string>(VECTOR_OVERLAYS.map((o) => o.id));

export function isVectorOverlayId(v: unknown): v is VectorOverlayId {
  return typeof v === "string" && OVERLAY_IDS.has(v);
}

export type VectorOverlayFamilyDef = {
  id: VectorOverlayFamilyId;
  /** Menu label — includes the member periods so the member knows what "EMA" expands to. */
  label: string;
  /** Representative colour for the menu dot (each member line carries its own colour). */
  color: string;
  /** The concrete overlay lines this family draws when enabled (draw order preserved). */
  memberIds: readonly VectorOverlayId[];
};

/**
 * The moving-average TYPES the member toggles. Derived from `VECTOR_OVERLAYS` so the two can't
 * drift: members are every overlay sharing the family, in registry order; the representative colour
 * is the first member's. VWAP is a family of one — kept a family so the menu is uniform.
 */
export const VECTOR_OVERLAY_FAMILIES: readonly VectorOverlayFamilyDef[] = (() => {
  const order: VectorOverlayFamilyId[] = ["vwap", "ema", "sma"];
  const labels: Record<VectorOverlayFamilyId, string> = { vwap: "VWAP", ema: "EMA", sma: "SMA" };
  return order.map((fam) => {
    const members = VECTOR_OVERLAYS.filter((o) => o.family === fam);
    const periods = members.map((m) => m.period).filter((p): p is number => p != null);
    const label = periods.length ? `${labels[fam]} (${periods.join(" · ")})` : labels[fam];
    return { id: fam, label, color: members[0]!.color, memberIds: members.map((m) => m.id) };
  });
})();

const FAMILY_IDS = new Set<string>(VECTOR_OVERLAY_FAMILIES.map((f) => f.id));

export function isVectorOverlayFamilyId(v: unknown): v is VectorOverlayFamilyId {
  return typeof v === "string" && FAMILY_IDS.has(v);
}

/**
 * Whether a moving-average family can actually draw at the current bar count. `emaSeries`/`smaSeries`
 * produce their first value only once `period` bars exist (VWAP needs just one), so a higher
 * timeframe — where a 6.5h session is only a handful of bars — can leave SMA 200 permanently
 * un-computable. The menu uses this to annotate (and disable, when nothing at all draws) so an
 * enabled toggle that renders nothing is explained rather than looking broken.
 *
 * - `full`    — every member has enough bars.
 * - `partial` — some members draw, some don't (`missing` lists the periods that can't).
 * - `none`    — not even the shortest member can draw; `minBars` is how many it needs.
 */
export function overlayFamilyAvailability(
  familyId: VectorOverlayFamilyId,
  barCount: number
): { status: "full" | "partial" | "none"; minBars: number; missing: number[] } {
  const members = VECTOR_OVERLAYS.filter((o) => o.family === familyId);
  // Bars a member needs before its first point is defined: its lookback, or 1 for VWAP.
  const req = (o: VectorOverlayDef) => o.period ?? 1;
  const minBars = Math.min(...members.map(req));
  const missing = members.filter((o) => barCount < req(o)).map((o) => o.period ?? 1);
  const drawable = members.length - missing.length;
  const status = drawable === members.length ? "full" : drawable === 0 ? "none" : "partial";
  return { status, minBars, missing };
}

/**
 * "Levels" indicators — horizontal price-line overlays (drawn like the king anchor, not per-bar
 * series). Each id maps to `levelLinesFor(id, bars)` in `vector-key-levels`, which yields one or
 * more lines. Same opt-in/default-off contract as the overlays. These are already one toggle per
 * type (HOD/LOD, opening range, …), so they need no family layer.
 */
export type VectorLevelId = "hod-lod" | "opening-range" | "fib" | "fib-auto" | "pdh-pdl-pdc" | "pivots";

export type VectorLevelDef = {
  id: VectorLevelId;
  label: string;
  /** Representative colour for the menu dot (the individual lines carry their own colours). */
  color: string;
  group: "Key levels";
  /** True when the level needs the prior-day OHLC fetch (PDH/PDL/PDC, pivots) rather than just the
   *  current session bars. The chart lazily fetches that once when any such level is enabled. */
  needsPriorDay?: boolean;
  /** Optional menu tooltip — used for "Fib"/"Auto fib" (2026-08-05 audit finding): the two use
   *  DIFFERENT retracement-direction conventions (Fib is always measured HOD-down-to-LOD; Auto fib
   *  follows whichever way the dominant swing actually ran), so a member toggling both can see them
   *  point opposite ways with no explanation on the chart. A menu tooltip is the cheap fix — see
   *  `vector-key-levels.ts`'s `fibLevels`/`vector-fib-swing.ts`'s `swingRetracement` for the code. */
  hint?: string;
};

/**
 * Opening-range window presets a member can pick (2026-08-05 audit finding #7 — previously
 * hardcoded to 15 minutes with no UI to change it). 15m stays the default so anyone who hasn't
 * touched the control sees the exact same behavior as before.
 */
export const VECTOR_OPENING_RANGE_PRESETS = [5, 15, 30, 60] as const;

export type VectorOpeningRangeMinutes = (typeof VECTOR_OPENING_RANGE_PRESETS)[number];

export const DEFAULT_OPENING_RANGE_MINUTES: VectorOpeningRangeMinutes = 15;

export function isVectorOpeningRangeMinutes(v: unknown): v is VectorOpeningRangeMinutes {
  return typeof v === "number" && (VECTOR_OPENING_RANGE_PRESETS as readonly number[]).includes(v);
}

/** The "Opening range" menu label with the ACTUAL selected window baked in (e.g. "(30m)"), so the
 *  toggle menu never shows a stale "15m" once the member has picked a different preset. */
export function openingRangeLabel(minutes: VectorOpeningRangeMinutes): string {
  return `Opening range (${minutes}m)`;
}

export const VECTOR_LEVELS: readonly VectorLevelDef[] = [
  { id: "hod-lod", label: "HOD / LOD", color: "#34d399", group: "Key levels" },
  {
    id: "opening-range",
    label: openingRangeLabel(DEFAULT_OPENING_RANGE_MINUTES),
    color: "#a78bfa",
    group: "Key levels",
  },
  {
    id: "fib",
    label: "Fibonacci (HOD→LOD)",
    color: "#ffd60a",
    group: "Key levels",
    hint: "Fixed session convention: always measured from the high down to the low, regardless of which one printed first.",
  },
  {
    id: "fib-auto",
    label: "Auto fib + golden pocket",
    color: "#fde047",
    group: "Key levels",
    hint: "Direction-aware: follows whichever way the dominant swing actually ran, so it can point the opposite way from the fixed \"Fib\" tool above.",
  },
  { id: "pdh-pdl-pdc", label: "PDH / PDL / PDC", color: "#38bdf8", group: "Key levels", needsPriorDay: true },
  // Lime, not orange (2026-08-05 audit finding #6): #fb923c collided with EMA 9's menu swatch —
  // a member with both toggles on couldn't tell the two dots apart in the toggle menu.
  { id: "pivots", label: "Floor pivots (P/R/S)", color: "#a3e635", group: "Key levels", needsPriorDay: true },
] as const;

const LEVEL_IDS = new Set<string>(VECTOR_LEVELS.map((l) => l.id));

export function isVectorLevelId(v: unknown): v is VectorLevelId {
  return typeof v === "string" && LEVEL_IDS.has(v);
}

/**
 * "Structure" indicators — chart MARKERS (pivot labels + BOS/CHOCH flags), not lines or series.
 * One toggle; the chart maps it to a dedicated series-markers instance fed by
 * `buildStructureMarkers`. Same opt-in/default-off contract as everything else in the menu.
 */
export type VectorStructureId = "market-structure";

export function isVectorStructureId(v: unknown): v is VectorStructureId {
  return v === "market-structure";
}

/**
 * "Oscillators" — momentum studies drawn in their OWN sub-pane BELOW the price pane (not overlaid
 * on price, whose scale is unrelated). Each maps to a `vector-indicators` computer and a dedicated
 * lightweight-charts pane. RSI needs `period+1` bars, MACD needs the slow EMA's seed, so a coarse
 * timeframe with too few bars simply draws nothing (honest, like the levels).
 */
export type VectorOscillatorId = "rsi" | "macd";

export function isVectorOscillatorId(v: unknown): v is VectorOscillatorId {
  return v === "rsi" || v === "macd";
}

/**
 * "Confluence" — a single toggle that highlights the strongest CONFLUENCE ZONE on the price pane:
 * the tight band where several INDEPENDENT levels (dealer walls, gamma flip, max pain, golden
 * pocket, session/prior-day levels) stack. The desk terminal already RANKS these zones as text;
 * this draws the top one on the chart so the member sees *where* on the tape the agreement sits.
 * It maps to a dedicated band-paint path in the chart (not `levelLinesFor`, which is pure over bars)
 * because the zone is derived from live walls/flip/max-pain, not just the candle series.
 */
export type VectorConfluenceId = "confluence-band";

export function isVectorConfluenceId(v: unknown): v is VectorConfluenceId {
  return v === "confluence-band";
}

/**
 * "Flow" — chart MARKERS at the strike + time of notable LARGE option prints (institutional-size
 * trades), so the member sees WHERE big money is hitting relative to the candles and gamma walls.
 * One toggle (default OFF, like everything else here); the chart maps it to a dedicated
 * createSeriesMarkers instance fed by the horizon-scoped `/api/market/vector/flow` read. Distinct
 * from the wall-bead and structure-marker instances so the three never clobber each other.
 */
export type VectorFlowId = "flow-markers";

export function isVectorFlowId(v: unknown): v is VectorFlowId {
  return v === "flow-markers";
}

/**
 * "Expected move" — the options-implied ±1σ/2σ price band the chain is pricing through the horizon's
 * front expiry, drawn as dashed price-lines (the "cone" #15). One toggle (default OFF); the chart
 * draws 4 lines (1σ/2σ low+high) from the horizon-scoped `/api/market/vector/expected-move` read,
 * cleared when the toggle is off or there's no real ATM IV to price it.
 */
export type VectorExpectedMoveId = "expected-move";

export function isVectorExpectedMoveId(v: unknown): v is VectorExpectedMoveId {
  return v === "expected-move";
}

/**
 * "Expected move — CONE" — the honest "remaining intraday move" companion to the flat ±1σ/2σ band.
 * The flat band is the WHOLE-session range as horizontal lines; this draws the move STILL AHEAD from
 * "now" to the 16:00 close as a shaded cone that narrows toward the close, because expected move
 * scales with √time so the remaining-time move budget decays as the session burns down (geometry in
 * `vector-em-cone.ts`, painted by `EmConePrimitive` at zOrder "bottom"). One toggle, DEFAULT OFF (a
 * new visual members opt into — NOT in `VECTOR_DEFAULT_ENABLED_INDICATORS`); strictly additive, so a
 * member can run the flat band, the cone, or both. Real-data-only: a null band/spot or off-hours
 * clock draws nothing, never a fabricated cone.
 */
export type VectorExpectedMoveConeId = "expected-move-cone";

export function isVectorExpectedMoveConeId(v: unknown): v is VectorExpectedMoveConeId {
  return v === "expected-move-cone";
}

/**
 * "Positioning" — the strike×time dealer-gamma (GEX) surface drawn as a background HEATMAP BEHIND
 * the candles (task #14). x = time, y = strike (price axis), cell colour = signed net GEX intensity
 * (call-dominated positive → cyan/teal, put-dominated negative → magenta). Defaults ON via
 * `VECTOR_DEFAULT_ENABLED_INDICATORS`; the chart maps it to a lightweight-charts series PRIMITIVE whose paneView renders at `zOrder:
 * "bottom"` so the surface sits under the price action. DTE-aware (re-scopes with the horizon toggle
 * like the walls/max-pain/cone) and real-data-only — an empty/absent grid draws nothing, never a
 * fabricated surface. Distinct from `/api/market/gex-heatmap` (the standalone strike×EXPIRY matrix
 * page): this is a horizon-scoped strike×TIME grid fed by the same reconstruction the walls use.
 */
export type VectorGexHeatmapId = "gex-heatmap";

export function isVectorGexHeatmapId(v: unknown): v is VectorGexHeatmapId {
  return v === "gex-heatmap";
}

/**
 * "Positioning" — the dealer-gamma REGIME as a boundary GLOW hugging the gamma-flip line, rather
 * than a text banner. The flip is where net dealer gamma changes sign, so it is a regime boundary:
 * ABOVE it dealers are LONG gamma → hedge against moves → the tape PINS / mean-reverts (cool teal);
 * BELOW it dealers are SHORT gamma → hedge with moves → the tape TRENDS / is unstable (warm amber).
 * The chart maps this to a lightweight-charts PRIMITIVE that draws a soft, low-alpha vertical
 * gradient ~52px each side of the flip (fading to 0 at the edge) — a boundary glow, NOT a full-pane
 * wash, so it coexists with the default-on GEX heatmap without muddying it. Real-data-only: a null/
 * non-finite flip draws nothing, never a fabricated regime. Defaults OFF (not in
 * `VECTOR_DEFAULT_ENABLED_INDICATORS`) — a new visual members opt into.
 */
export type VectorGammaRegimeId = "gamma-regime";

export function isVectorGammaRegimeId(v: unknown): v is VectorGammaRegimeId {
  return v === "gamma-regime";
}

/**
 * "Volume profile" — the session's volume bucketed by PRICE (not time), drawn as horizontal bars
 * anchored to the right edge of the chart, background-layer like the GEX heatmap/gamma-regime glow.
 * Pairs with the GEX ladder's volume-at-STRIKE view: this is volume-at-PRICE for the underlying, so
 * a member can see whether the heaviest-traded zone lines up with a dealer wall. Computed client-side
 * from the SAME 1m session bars already seeded/streamed for the candles — no new data source. One
 * toggle (default OFF, like every other opt-in overlay); real-data-only — no volume this session
 * (off-hours, a brand-new ticker) draws nothing, never a fabricated profile.
 */
export type VectorVolumeProfileId = "volume-profile";

export function isVectorVolumeProfileId(v: unknown): v is VectorVolumeProfileId {
  return v === "volume-profile";
}

/** Bead-rail display toggles — canvas primitive channels (not separate chart layers). */
export type VectorBeadDisplayId =
  | "bead-integrity-rings"
  | "bead-dollar-sizing"
  | "bead-event-glyphs";

export function isVectorBeadDisplayId(v: unknown): v is VectorBeadDisplayId {
  return v === "bead-integrity-rings" || v === "bead-dollar-sizing" || v === "bead-event-glyphs";
}

export const VECTOR_BEAD_DISPLAY: ReadonlyArray<{
  id: VectorBeadDisplayId;
  label: string;
  /** Short label for the desk toolbar on/off chip. */
  toolbarLabel: string;
  color: string;
  hint?: string;
}> = [
  {
    id: "bead-integrity-rings",
    label: "Integrity rings (firm / moderate / thin)",
    toolbarLabel: "Rings",
    color: "#eab308",
    hint: "Outer halo shows wall confidence — matches the desk terminal score",
  },
  {
    id: "bead-dollar-sizing",
    label: "Dollar gamma sizing ($200M–$2.5B ladder)",
    toolbarLabel: "$ Size",
    color: "#7c3aed",
    hint: "Bead size from live $|gamma| — off uses frame-relative strength only",
  },
  {
    id: "bead-event-glyphs",
    label: "Event glyphs (birth, handover, flip cross, break)",
    toolbarLabel: "Events",
    color: "#d946ef",
    hint: "Sparse punctuation on the bead rail — hover a glyph for the full event",
  },
] as const;

/**
 * Every toggleable indicator id — a moving-average FAMILY (not an individual line), a level, a
 * structure toggle, or an oscillator. This is what the enabled Set and the menu deal in; the chart
 * expands each to its lines/markers/panes at draw time.
 */
export type VectorIndicatorId =
  | VectorOverlayFamilyId
  | VectorLevelId
  | VectorStructureId
  | VectorOscillatorId
  | VectorConfluenceId
  | VectorFlowId
  | VectorExpectedMoveId
  | VectorExpectedMoveConeId
  | VectorGexHeatmapId
  | VectorGammaRegimeId
  | VectorVolumeProfileId
  | VectorBeadDisplayId;

/** Menu structure — the toggle menu renders straight from this (title + its items). */
export const VECTOR_INDICATOR_GROUPS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<{ id: VectorIndicatorId; label: string; color: string; hint?: string }>;
}> = [
  {
    title: "Moving averages",
    items: VECTOR_OVERLAY_FAMILIES.map((f) => ({ id: f.id, label: f.label, color: f.color })),
  },
  {
    title: "Key levels",
    items: VECTOR_LEVELS.map((l) => ({ id: l.id, label: l.label, color: l.color, hint: l.hint })),
  },
  {
    title: "Structure",
    // Fuchsia, not cyan (2026-08-05 audit finding #6): #22d3ee collided with "Expected move"'s menu
    // swatch. Expected move keeps cyan because its ACTUAL chart lines/cone are hardcoded to #22d3ee
    // to match (see vector-em-cone-primitive.ts / VectorChart.tsx) — structure's markers don't share
    // that constraint, so this toggle moved instead.
    items: [{ id: "market-structure", label: "Market structure (HH/HL · BOS/CHOCH)", color: "#e879f9" }],
  },
  {
    title: "Oscillators",
    items: [
      { id: "rsi", label: "RSI (14)", color: "#c084fc" },
      // Indigo, not sky (2026-08-05 audit finding #6): #38bdf8 collided with the "PDH / PDL / PDC"
      // key-level menu swatch.
      { id: "macd", label: "MACD (12/26/9)", color: "#818cf8" },
    ],
  },
  {
    title: "Confluence",
    items: [{ id: "confluence-band", label: "Confluence zone (strongest stack)", color: "#f59e0b" }],
  },
  {
    title: "Flow",
    // Green-400, not emerald (2026-08-05 audit finding #6): #34d399 collided with the "HOD / LOD"
    // key-level menu swatch. Still green (matches the call-print marker colour — calls green ↑ /
    // puts red ↓ on the chart), just a distinct shade from HOD/LOD's emerald.
    items: [{ id: "flow-markers", label: "Options flow (large trades at strike)", color: "#4ade80" }],
  },
  {
    title: "Expected move",
    // Cyan matches the dashed ±1σ/2σ band lines drawn on the chart. The cone is a distinct sky-cyan
    // dot so members can tell the "remaining move" funnel apart from the flat whole-session band.
    items: [
      { id: "expected-move", label: "Expected move (±1σ/2σ range)", color: "#22d3ee" },
      { id: "expected-move-cone", label: "EM cone (remaining move)", color: "#67e8f9" },
    ],
  },
  {
    title: "Positioning",
    items: [
      {
        id: "gex-heatmap",
        label: "GEX heatmap (reconstructed dealer positioning)",
        color: "#10b981",
      },
      {
        // Rose dot (2026-08-05 audit finding #6): was teal (#2dd4bf), which collided with "SMA 50"'s
        // menu swatch AND real drawn line colour. The on-chart boundary glow itself is unaffected —
        // it's still calm-teal/short-γ-amber, painted independently by
        // vector-gamma-regime-primitive.ts — only this toggle's menu dot moved.
        id: "gamma-regime",
        label: "Gamma regime (long / short γ zones)",
        color: "#fb7185",
      },
    ],
  },
  {
    title: "Volume profile",
    items: [
      // Slate dot for the base bars; the POC/value-area colours (gold/cyan) show once enabled.
      { id: "volume-profile", label: "Volume profile (session, by price)", color: "#94a3b8" },
    ],
  },
  {
    title: "Bead rail",
    items: VECTOR_BEAD_DISPLAY.map((b) => ({
      id: b.id,
      label: b.label,
      color: b.color,
      hint: b.hint,
    })),
  },
];

/** Indicators enabled on first paint — dealer gamma positioning + bead integrity rings + event glyphs. */
export const VECTOR_DEFAULT_ENABLED_INDICATORS: readonly VectorIndicatorId[] = [
  "gex-heatmap",
  "bead-integrity-rings",
  "bead-event-glyphs",
] as const;

export function defaultVectorIndicators(): Set<VectorIndicatorId> {
  return new Set(VECTOR_DEFAULT_ENABLED_INDICATORS);
}
