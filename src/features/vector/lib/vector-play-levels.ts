// PLAY LEVELS → chart price-lines (Tier-1 "plays on the chart", 2026-07-26).
//
// Pure mapping from the ACTIVE SPX play (useSpxPlay payload) to the set of labeled price-lines the
// Vector chart draws on the price pane, so a member sees their entry / stop / target / invalidation
// right on the tape they are trading — the single surface that stitches the SPX play engine and the
// chart together. SPX play levels are INDEX-price levels (entry_price / stop / target are spot, not
// option premium), so they drop straight onto the candle series' price scale.
//
// Pure + deterministic (no React, no I/O, no Date): the chart layer owns drawing/lifecycle; this file
// only decides WHICH lines exist and how they look. Emits nothing for a non-finite price, so a
// half-populated payload never draws a fabricated level.

export type PlayLineKind = "entry" | "stop" | "target" | "invalidation";
export type PlayLineStyle = "solid" | "dashed" | "dotted";

/** One resolved price-line spec the chart draws (kind + price + presentation). */
export type PlayLevelLine = {
  kind: PlayLineKind;
  price: number;
  label: string;
  color: string;
  style: PlayLineStyle;
  width: 1 | 2;
};

/** Lifecycle of the play whose levels we're drawing. */
export type PlayLevelsState = "open" | "idea" | "none";

/** Normalized input — the chart maps the raw SpxPlayPayload into this so the helper stays payload-shape-agnostic. */
export type PlayLevelsInput = {
  /** "open" = a live position (solid/bold lines); "idea" = a proposed setup not yet entered (dotted/faint);
   *  "none" = nothing to draw. */
  state: PlayLevelsState;
  direction: "long" | "short" | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  invalidation: number | null;
};

// Palette — chosen to match the chart's existing semantic colors (green up / red down / amber caution)
// and to stay distinct from the wall beads, gamma-flip cyan, and pin gold.
const ENTRY_COLOR = "#e7eef6"; // near-white: the anchor the P&L is measured from — neutral, not a bull/bear call
const STOP_COLOR = "#ff2d55"; // red: risk / where the thesis is wrong
const TARGET_COLOR = "#00e676"; // green: the objective
const INVALIDATION_COLOR = "#ff8a3d"; // amber: structural invalidation (distinct from the hard stop)

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

function line(
  kind: PlayLineKind,
  price: number | null,
  label: string,
  color: string,
  style: PlayLineStyle,
  width: 1 | 2
): PlayLevelLine | null {
  // Real-data-only: a null / NaN / non-positive level draws nothing (never a fabricated line).
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return { kind, price, label: `${label} ${fmt(price)}`, color, style, width };
}

/**
 * Resolve the price-lines for the active play. An OPEN position draws bold/solid lines (it's live
 * risk you're managing); a pending IDEA draws faint dotted lines (where the setup WOULD trigger),
 * so the two never look the same. `state: "none"` (no play) draws nothing. The direction word is
 * folded into each label ("LONG entry", "SHORT stop") so the tape reads unambiguously.
 */
export function playLevelLines(input: PlayLevelsInput): PlayLevelLine[] {
  if (input.state === "none") return [];
  const open = input.state === "open";
  const style: PlayLineStyle = open ? "solid" : "dotted";
  const width: 1 | 2 = open ? 2 : 1;
  const dir = input.direction === "short" ? "SHORT" : input.direction === "long" ? "LONG" : "";
  const tag = (word: string): string => (dir ? `${dir} ${word}` : word);

  const out: Array<PlayLevelLine | null> = [
    // Entry keeps a solid style even for an idea (it's the trigger level), but stays thin when unfilled.
    line("entry", input.entry, tag("entry"), ENTRY_COLOR, open ? "solid" : "dashed", width),
    line("stop", input.stop, tag("stop"), STOP_COLOR, style, width),
    line("target", input.target, tag("target"), TARGET_COLOR, style, width),
    line("invalidation", input.invalidation, "invalidation", INVALIDATION_COLOR, "dotted", 1),
  ];
  return out.filter((l): l is PlayLevelLine => l !== null);
}

/** Colors are exported so the chart legend / rail can match the drawn lines exactly. */
export const PLAY_LEVEL_COLORS = {
  entry: ENTRY_COLOR,
  stop: STOP_COLOR,
  target: TARGET_COLOR,
  invalidation: INVALIDATION_COLOR,
} as const;
