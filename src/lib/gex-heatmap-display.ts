/** Shared GEX heatmap cell formatting + color scale (Thermal + SPX Slayer matrix). */

import type { CSSProperties } from "react";
import { fmtPremium as fmtHeatmapMoney } from "@/lib/fmt-money";

export { fmtHeatmapMoney };

/** SPX Slayer matrix uses gex/vex; Thermal adds dex/charm on the same cell scale. */
export type GexHeatmapLens = "gex" | "vex" | "dex" | "charm";

/** Vector call/put bead colors — canonical for matrix peak nodes (matches VectorChart). */
export const GEX_BEAD_CALL_HEX = "#ffd60a";
export const GEX_BEAD_PUT_HEX = "#d97bff";
export const GEX_BEAD_CALL_RGB = "255, 214, 10";
export const GEX_BEAD_PUT_RGB = "217, 123, 255";

const LENS_COLORS: Record<GexHeatmapLens, { posRgb: string; negRgb: string }> = {
  gex: { posRgb: "0, 230, 118", negRgb: "255, 45, 85" },
  vex: { posRgb: "125, 211, 252", negRgb: "255, 45, 85" },
  dex: { posRgb: "34, 211, 238", negRgb: "255, 45, 85" },
  charm: { posRgb: "255, 210, 63", negRgb: "255, 45, 85" },
};

/** Signed cell value — competitor-style shows $0.0K at zero when showZero is true. */
export function fmtHeatmapMoneySigned(n: number, opts?: { showZero?: boolean }): string {
  if (n === 0) return opts?.showZero ? "$0.0K" : "·";
  return n > 0 ? `+${fmtHeatmapMoney(n)}` : fmtHeatmapMoney(n);
}

export function heatmapCellStyle(
  value: number,
  peak: number,
  lens: GexHeatmapLens
): CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.03 + Math.pow(mag, 1.35) * 0.7;
  const c = LENS_COLORS[lens];
  const rgb = value > 0 ? c.posRgb : c.negRgb;
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.55 ? `inset 0 0 14px rgba(${rgb},${(mag * 0.32).toFixed(2)})` : undefined,
  };
}

export function heatmapCellTextStyle(value: number, peak: number): CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  if (mag > 0.55) return { color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" };
  return { textShadow: "0 1px 2px rgba(0,0,0,0.72)" };
}

/** Per-column highest positive cell — call-bead yellow (dominant +GEX node). */
export function heatmapExtremePositiveStyle(): CSSProperties {
  return {
    backgroundColor: `rgba(${GEX_BEAD_CALL_RGB}, 0.46)`,
    boxShadow: `inset 0 0 0 1px rgba(${GEX_BEAD_CALL_RGB}, 0.75), 0 0 12px rgba(${GEX_BEAD_CALL_RGB}, 0.28)`,
  };
}

/** Per-column highest negative cell — put-bead purple (dominant −GEX node). */
export function heatmapExtremeNegativeStyle(): CSSProperties {
  return {
    backgroundColor: `rgba(${GEX_BEAD_PUT_RGB}, 0.44)`,
    boxShadow: `inset 0 0 0 1px rgba(${GEX_BEAD_PUT_RGB}, 0.75), 0 0 12px rgba(${GEX_BEAD_PUT_RGB}, 0.26)`,
  };
}

export function heatmapExtremePositiveTextStyle(): CSSProperties {
  return {
    color: "#fffbeb",
    textShadow: `0 0 8px rgba(${GEX_BEAD_CALL_RGB}, 0.75), 0 1px 2px rgba(0,0,0,0.65)`,
  };
}

export function heatmapExtremeNegativeTextStyle(): CSSProperties {
  return {
    color: "#faf5ff",
    textShadow: `0 0 8px rgba(${GEX_BEAD_PUT_RGB}, 0.75), 0 1px 2px rgba(0,0,0,0.65)`,
  };
}

/** Style bundle for matrix peak cells (positive / negative per expiry column). */
export function heatmapMatrixExtremeCellStyle(
  kind: "positive" | "negative"
): CSSProperties {
  return kind === "positive"
    ? { ...heatmapExtremePositiveStyle(), ...heatmapExtremePositiveTextStyle() }
    : { ...heatmapExtremeNegativeStyle(), ...heatmapExtremeNegativeTextStyle() };
}

/**
 * The matrix's colour key.
 *
 * The grid encodes five different things in colour — sign, magnitude, the column's strongest
 * positive node, the column's strongest negative node, and "no contract listed here" — and until
 * this existed it explained none of them. A reader could see that some cells were brighter and two
 * were a completely different colour, and had no way to learn what either meant.
 *
 * It lives HERE, next to the styles it describes, deliberately: a legend kept in the component
 * would drift the first time `LENS_COLORS` or the extreme-cell styles changed, and a wrong legend
 * is worse than none. Same reason it reads its swatches from the same constants the cells do
 * rather than repeating the hexes.
 */
export type HeatmapLegendItem =
  | { kind: "scale"; fromHex: string; toHex: string; negLabel: string; posLabel: string; help: string }
  | { kind: "swatch"; hex: string; label: string; help: string }
  | { kind: "empty"; glyph: string; label: string; help: string };

function rgbToHex(rgb: string): string {
  const [r, g, b] = rgb.split(",").map((p) => Number(p.trim()));
  const hex = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * @param lens   which metric the matrix is painting (drives the positive-side colour)
 * @param vocab  the lens's own nouns, so the key says "long γ / short γ" not "positive / negative"
 */
export function heatmapLegendItems(
  lens: GexHeatmapLens,
  vocab: { noun: string; pos: string; neg: string }
): HeatmapLegendItem[] {
  const c = LENS_COLORS[lens];
  const metric = vocab.noun.toLowerCase();
  return [
    {
      kind: "scale",
      fromHex: rgbToHex(c.negRgb),
      toHex: rgbToHex(c.posRgb),
      negLabel: vocab.neg,
      posLabel: vocab.pos,
      help: `Cell colour is the sign of net dealer ${metric} at that strike and expiry; brightness is its size relative to the largest cell on screen.`,
    },
    {
      kind: "swatch",
      hex: GEX_BEAD_CALL_HEX,
      label: "column peak +",
      help: `The strongest positive ${metric} node in that expiry's column — the level dealers are most positioned to defend from above.`,
    },
    {
      kind: "swatch",
      hex: GEX_BEAD_PUT_HEX,
      label: "column peak −",
      help: `The strongest negative ${metric} node in that expiry's column — the level where dealer hedging most amplifies a move.`,
    },
    {
      kind: "empty",
      glyph: "·",
      label: "not listed",
      help: "No contract exists at that strike and expiry. Distinct from $0.0K, which means the contract is listed but currently carries no exposure.",
    },
  ];
}

export function fmtHeatmapExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

export function fmtHeatmapStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}

/**
 * Signed % distance of a strike from live spot — same formula as SPX desk `distance_pct`
 * and Largo rail `distancePct`: ((strike − spot) / spot) × 100.
 */
export function strikeDistancePct(
  spot: number | null | undefined,
  strike: number | null | undefined,
): number | null {
  if (!Number.isFinite(spot as number) || !Number.isFinite(strike as number) || (spot as number) <= 0) {
    return null;
  }
  return ((Number(strike) - Number(spot)) / Number(spot)) * 100;
}

/** "+0.12%" / "−0.05%" / "—" — two decimals, true minus sign (desk ladder parity). */
export function fmtStrikeDistancePct(
  spot: number | null | undefined,
  strike: number | null | undefined,
): string {
  const pct = strikeDistancePct(spot, strike);
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Math.abs(pct) < 0.005 ? 0 : pct;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(2)}%`;
}
