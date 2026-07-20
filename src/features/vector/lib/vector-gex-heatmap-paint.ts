import type { GexHeatmapGrid } from "./vector-gex-reconstruct";
import { bandEdges, type Band } from "./vector-chart-geometry";

/**
 * Pure paint/geometry layer for the strike×time GEX positioning heatmap (task #14) — the part the
 * canvas primitive delegates to so the colour mapping and the cell→rect geometry are unit-testable
 * WITHOUT a DOM/canvas or a live chart. The primitive (`vector-gex-heatmap-primitive.ts`) only wires
 * the chart's `priceToCoordinate` / `timeToCoordinate` into `heatmapRects` and blits the result.
 *
 * Kept dependency-light (type-only import of the grid shape) so it stays deterministic and pure.
 */

/** call-dominated (+GEX) pole — cyan/teal, matching the "positive gamma" convention. */
const CALL_RGB = [34, 211, 238] as const; // #22d3ee
/** put-dominated (−GEX) pole — magenta/fuchsia, the diverging opposite of the call teal. */
const PUT_RGB = [217, 70, 239] as const; // #d946ef

/**
 * Alpha envelope. This is a BACKGROUND layer drawn at `zOrder: "bottom"` (under the candles, walls
 * and overlays), so the ceiling is deliberately low — even the heaviest cell must stay subtle enough
 * that the price action reads cleanly on top. `MIN_ALPHA` keeps a faint-but-present tint on the
 * weakest non-zero cell so the surface's extent is legible.
 *
 * A power curve (GAMMA > 1) compresses weak cells toward transparency and stretches strong cells
 * toward the ceiling, so the dominant strikes pop while the noise fades out — without the linear
 * ramp's "everything looks the same" flatness.
 */
const MIN_ALPHA = 0.03;
const MAX_ALPHA = 0.55;
const GAMMA = 1.6;

/** Fully-transparent sentinel — returned for empty/zero cells so a caller can skip the blit. */
export const HEATMAP_TRANSPARENT = "rgba(0,0,0,0)";

/**
 * Map one signed cell (net dealer GEX; + call, − put) to its background colour. Intensity is
 * `|cell| / maxAbs` clamped to [0,1]; the sign picks the diverging pole (cyan up / magenta down).
 * Zero cells, a non-finite value, or a non-positive `maxAbs` (empty grid) map to transparent — the
 * honest "nothing here" so absence never paints a colour.
 */
export function heatmapCellColor(signed: number, maxAbs: number): string {
  if (!(maxAbs > 0) || !Number.isFinite(signed) || signed === 0) return HEATMAP_TRANSPARENT;
  const intensity = Math.min(1, Math.abs(signed) / maxAbs);
  const curved = Math.pow(intensity, GAMMA);
  const alpha = MIN_ALPHA + curved * (MAX_ALPHA - MIN_ALPHA);
  const [r, g, b] = signed > 0 ? CALL_RGB : PUT_RGB;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

/** One drawable cell in canvas media coordinates. */
export type HeatmapRect = { x: number; y: number; w: number; h: number; color: string };

export { bandEdges } from "./vector-chart-geometry";

/**
 * Project a `GexHeatmapGrid` into drawable rects. `xForTime`/`yForStrike` are the chart's
 * `timeScale().timeToCoordinate` / `series.priceToCoordinate` (injected so this stays pure). Only
 * NON-ZERO cells become rects — an absent/zero cell draws nothing — and a column or row whose
 * coordinate can't be resolved is skipped. Returns [] for an empty grid or a non-positive `maxAbs`,
 * so "no honest data" renders as literally nothing.
 */
export function heatmapRects(
  grid: GexHeatmapGrid,
  xForTime: (time: number) => number | null,
  yForStrike: (strike: number) => number | null
): HeatmapRect[] {
  const { times, strikes, cells, maxAbs } = grid;
  if (!times.length || !strikes.length || !(maxAbs > 0)) return [];

  const xBands = bandEdges(times.map(xForTime));
  const yBands = bandEdges(strikes.map(yForStrike));

  const out: HeatmapRect[] = [];
  for (let ti = 0; ti < times.length; ti++) {
    const xb = xBands[ti];
    if (!xb) continue;
    const row = cells[ti];
    if (!row) continue;
    for (let si = 0; si < strikes.length; si++) {
      const v = row[si] ?? 0;
      if (v === 0) continue; // no gamma at this (time, strike) → paint nothing
      const yb = yBands[si];
      if (!yb) continue;
      out.push({
        x: xb.lo,
        y: yb.lo,
        w: xb.hi - xb.lo,
        h: yb.hi - yb.lo,
        color: heatmapCellColor(v, maxAbs),
      });
    }
  }
  return out;
}
