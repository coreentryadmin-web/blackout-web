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
  const alpha = 0.04 + Math.pow(mag, 1.35) * 0.88;
  const c = LENS_COLORS[lens];
  const rgb = value > 0 ? c.posRgb : c.negRgb;
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.45 ? `inset 0 0 18px rgba(${rgb},${(mag * 0.4).toFixed(2)})` : undefined,
  };
}

export function heatmapCellTextStyle(value: number, peak: number): CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  if (mag > 0.45) return { color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.55)" };
  return { textShadow: "0 1px 2px rgba(0,0,0,0.72)" };
}

/** Per-column highest positive cell — call-bead yellow (dominant +GEX node). */
export function heatmapExtremePositiveStyle(): CSSProperties {
  return {
    backgroundColor: `rgba(${GEX_BEAD_CALL_RGB}, 0.58)`,
    boxShadow: `inset 0 0 0 1px rgba(${GEX_BEAD_CALL_RGB}, 0.9), 0 0 16px rgba(${GEX_BEAD_CALL_RGB}, 0.38)`,
  };
}

/** Per-column highest negative cell — put-bead purple (dominant −GEX node). */
export function heatmapExtremeNegativeStyle(): CSSProperties {
  return {
    backgroundColor: `rgba(${GEX_BEAD_PUT_RGB}, 0.55)`,
    boxShadow: `inset 0 0 0 1px rgba(${GEX_BEAD_PUT_RGB}, 0.9), 0 0 16px rgba(${GEX_BEAD_PUT_RGB}, 0.38)`,
  };
}

export function heatmapExtremePositiveTextStyle(): CSSProperties {
  return {
    color: "#fffbeb",
    textShadow: `0 0 10px rgba(${GEX_BEAD_CALL_RGB}, 0.95), 0 1px 2px rgba(0,0,0,0.65)`,
  };
}

export function heatmapExtremeNegativeTextStyle(): CSSProperties {
  return {
    color: "#faf5ff",
    textShadow: `0 0 10px rgba(${GEX_BEAD_PUT_RGB}, 0.95), 0 1px 2px rgba(0,0,0,0.65)`,
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

export function fmtHeatmapExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

export function fmtHeatmapStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
}
