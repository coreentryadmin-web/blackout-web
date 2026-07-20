import type { GexHeatmapGrid } from "./vector-gex-reconstruct";

/**
 * Pure paint/geometry layer for the strike×time GEX positioning heatmap (task #14) — the part the
 * canvas primitive delegates to so the colour mapping and the cell→rect geometry are unit-testable
 * WITHOUT a DOM/canvas or a live chart. The primitive (`vector-gex-heatmap-primitive.ts`) only wires
 * the chart's `priceToCoordinate` / `timeToCoordinate` into `heatmapRects` and blits the result.
 *
 * Kept dependency-light (type-only import of the grid shape) so it stays deterministic and pure.
 */

/** call-dominated (+GEX) — emerald, distinct from γ-flip cyan (#22d3ee) for CVD separation. */
const CALL_RGB = [16, 185, 129] as const; // #10b981
/** put-dominated (−GEX) pole — magenta/fuchsia. */
const PUT_RGB = [217, 70, 239] as const; // #d946ef

/**
 * Alpha envelope. This is a BACKGROUND layer drawn at `zOrder: "bottom"` (under the candles, walls
 * and overlays), so the ceiling is deliberately low — even the heaviest cell must stay subtle enough
 * that the price action reads cleanly on top. `MIN_ALPHA` keeps a faint-but-present tint on the
 * weakest non-zero cell so the surface's extent is legible.
 *
 * A power curve (GAMMA > 1) compresses weak cells toward transparency and stretches strong cells
 * toward the ceiling, so the dominant strikes pop while the noise fades out — without the linear
 * ramp's "everything looks same" flatness.
 */
const MIN_ALPHA = 0.03;
const MAX_ALPHA = 0.55;
const GAMMA = 1.6;

/** Default half-width (media px) when only one time column resolves — prevents zoom blanking. */
const DEFAULT_MIN_BAND_HALF_PX = 10;

/** Spot-path bucket size (seconds) for the Vector GEX heatmap fetch — finer when chart TF ≤ 5m. */
export function heatmapBucketSecForChartTimeframe(tfMinutes: number): 60 | 300 {
  return tfMinutes <= 5 ? 60 : 300;
}

/** Allowed spot-path bucket sizes (seconds) — shared by API route + server loader. */
export function normalizeHeatmapBucketSec(raw: unknown): 60 | 120 | 300 {
  const n = Number(raw);
  if (n === 60 || n === 120 || n === 300) return n;
  return 300;
}

/** Fully-transparent sentinel — returned for empty/zero cells so a caller can skip the blit. */
export const HEATMAP_TRANSPARENT = "rgba(0,0,0,0)";

export type HeatmapNormalizeMode = "global" | "column";

/**
 * Map one signed cell (net dealer GEX; + call, − put) to its background colour. Intensity is
 * `|cell| / maxAbs` clamped to [0,1]; the sign picks the diverging pole (emerald + / magenta −).
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

type Band = { lo: number; hi: number };

function columnMaxAbs(row: readonly number[]): number {
  let m = 0;
  for (const v of row) {
    const a = Math.abs(v);
    if (a > m) m = a;
  }
  return m;
}

/**
 * Turn a per-index array of axis coordinates into per-index [lo,hi] bands that TILE the axis with
 * no gaps or overlaps. When only one coordinate resolves, uses `minHalfWidth` so a lone column still
 * paints (fixes heatmap vanishing on tight zoom).
 */
export function bandEdges(
  coords: ReadonlyArray<number | null>,
  minHalfWidth = DEFAULT_MIN_BAND_HALF_PX
): Array<Band | null> {
  const n = coords.length;
  const out: Array<Band | null> = new Array(n).fill(null);
  const resolved: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    if (c != null && Number.isFinite(c)) resolved.push(i);
  }
  if (resolved.length === 0) return out;

  if (resolved.length === 1) {
    const i = resolved[0]!;
    const c = coords[i]!;
    out[i] = { lo: c - minHalfWidth, hi: c + minHalfWidth };
    return out;
  }

  for (let k = 0; k < resolved.length; k++) {
    const i = resolved[k]!;
    const c = coords[i]!;
    const left = k > 0 ? coords[resolved[k - 1]!]! : null;
    const right = k < resolved.length - 1 ? coords[resolved[k + 1]!]! : null;
    const edges: number[] = [];
    if (left != null) edges.push((left + c) / 2);
    if (right != null) edges.push((right + c) / 2);
    if (edges.length === 1) edges.push(c - (edges[0]! - c));
    out[i] = { lo: Math.min(edges[0]!, edges[1]!), hi: Math.max(edges[0]!, edges[1]!) };
  }
  return out;
}

/** Nearest grid time index for a crosshair epoch (seconds). */
export function nearestGridTimeIndex(grid: GexHeatmapGrid, epochSec: number): number {
  const { times } = grid;
  if (!times.length) return -1;
  let best = 0;
  let bestDist = Math.abs(times[0]! - epochSec);
  for (let i = 1; i < times.length; i++) {
    const d = Math.abs(times[i]! - epochSec);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Nearest strike row index for a hover price. */
export function nearestGridStrikeIndex(grid: GexHeatmapGrid, price: number): number {
  const { strikes } = grid;
  if (!strikes.length || !Number.isFinite(price)) return -1;
  let best = 0;
  let bestDist = Math.abs(strikes[0]! - price);
  for (let i = 1; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - price);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Signed GEX at the nearest (time, strike) cell — for crosshair legend when heatmap is on. */
export function gexCellAtGridPoint(
  grid: GexHeatmapGrid,
  epochSec: number,
  price: number
): { strike: number; value: number; time: number } | null {
  const ti = nearestGridTimeIndex(grid, epochSec);
  const si = nearestGridStrikeIndex(grid, price);
  if (ti < 0 || si < 0) return null;
  const row = grid.cells[ti];
  if (!row) return null;
  const value = row[si] ?? 0;
  if (value === 0) return null;
  return { strike: grid.strikes[si]!, value, time: grid.times[ti]! };
}

/**
 * Project a `GexHeatmapGrid` into drawable rects. `normalize: "column"` scales each time column
 * against its own peak |GEX| so intraday structure stays vivid even when one early spike dominates
 * the session global max.
 */
export function heatmapRects(
  grid: GexHeatmapGrid,
  xForTime: (time: number) => number | null,
  yForStrike: (strike: number) => number | null,
  opts?: { normalize?: HeatmapNormalizeMode; minBandHalfPx?: number }
): HeatmapRect[] {
  const { times, strikes, cells, maxAbs } = grid;
  if (!times.length || !strikes.length || !(maxAbs > 0)) return [];

  const normalize = opts?.normalize ?? "column";
  const xBands = bandEdges(
    times.map(xForTime),
    opts?.minBandHalfPx ?? DEFAULT_MIN_BAND_HALF_PX
  );
  const yBands = bandEdges(strikes.map(yForStrike));

  const out: HeatmapRect[] = [];
  for (let ti = 0; ti < times.length; ti++) {
    const xb = xBands[ti];
    if (!xb) continue;
    const row = cells[ti];
    if (!row) continue;
    const colMax = columnMaxAbs(row);
    const norm = normalize === "column" && colMax > 0 ? colMax : maxAbs;
    for (let si = 0; si < strikes.length; si++) {
      const v = row[si] ?? 0;
      if (v === 0) continue;
      const yb = yBands[si];
      if (!yb) continue;
      out.push({
        x: xb.lo,
        y: yb.lo,
        w: xb.hi - xb.lo,
        h: yb.hi - yb.lo,
        color: heatmapCellColor(v, norm),
      });
    }
  }
  return out;
}
