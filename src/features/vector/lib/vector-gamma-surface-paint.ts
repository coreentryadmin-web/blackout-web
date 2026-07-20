import type { GexHeatmapGrid } from "./vector-gex-reconstruct";

/**
 * Paint/geometry layer for the Gamma Surface — a continuous-zone background behind candles showing
 * three macro regimes: CALL pressure (gold, above the flip), PUT pressure (crimson, below), and the
 * NEUTRAL corridor around the gamma flip (teal). Unlike the per-cell GEX heatmap which shows every
 * strike individually, the surface aggregates into fluid zones so the member reads "am I in call
 * territory or put territory?" at a glance without counting dots.
 *
 * Reuses the same `GexHeatmapGrid` data the heatmap uses (no new fetch/endpoint), but renders it
 * fundamentally differently: each time column sums |GEX| above vs below the flip, and the zone
 * boundaries are smoothed across columns via exponential averaging so the surface flows rather than
 * jumping between frames.
 *
 * Pure + DOM-free — unit-testable without a canvas or chart.
 */

// ── Zone colours ──
// Gold = call/dealer resistance pressure (positive net GEX territory above flip)
const CALL_RGB = [235, 170, 40] as const;
// Teal = gamma-neutral corridor straddling the flip
const NEUTRAL_RGB = [20, 200, 180] as const;
// Crimson = put/dealer support pressure (negative net GEX territory below flip)
const PUT_RGB = [200, 45, 50] as const;

// Alpha envelope — must be subtle enough that candles stay readable.
const MIN_ALPHA = 0.04;
const MAX_ALPHA = 0.38;
// Power curve exponent: >1 compresses weak zones toward transparency, stretches strong ones.
const GAMMA = 1.4;

// Neutral corridor half-width as fraction of (HI - LO) price range.
const NEUTRAL_HALF_FRAC = 0.025;

/** Smoothing factor for zone boundaries across time columns (0 = no smoothing, 1 = sticky). */
const SMOOTH_ALPHA = 0.35;

/** One drawable rect in canvas media coordinates. */
export type SurfaceRect = { x: number; y: number; w: number; h: number; color: string };

type Band = { lo: number; hi: number };

/**
 * Per-column aggregation: for a single time slice, compute the call pressure (sum of +GEX above
 * flip), put pressure (sum of |GEX| below flip), and the flip's y-position for zone boundaries.
 */
type ColumnProfile = {
  /** Flip level for this column (may shift between columns as the flip moves intraday). */
  flipStrike: number;
  /** Sum of positive net GEX above the flip — call wall territory. */
  callPressure: number;
  /** Sum of |negative net GEX| below the flip — put wall territory. */
  putPressure: number;
  /** Maximum of callPressure and putPressure across all columns — for normalisation. */
};

/**
 * Build per-column pressure profiles from the grid + the flip level at each time.
 * `flipAtTime` returns the gamma flip for a given time bucket; when unavailable, uses the grid
 * midpoint as a fallback so the surface degrades gracefully rather than vanishing.
 */
export function buildColumnProfiles(
  grid: GexHeatmapGrid,
  flipAtTime: (time: number) => number | null
): ColumnProfile[] {
  const { times, strikes, cells } = grid;
  if (!strikes.length || !times.length) return [];

  const midStrike = strikes[Math.floor(strikes.length / 2)]!;
  const profiles: ColumnProfile[] = [];

  for (let ti = 0; ti < times.length; ti++) {
    const row = cells[ti];
    const flip = flipAtTime(times[ti]!) ?? midStrike;
    let callP = 0;
    let putP = 0;

    if (row) {
      for (let si = 0; si < strikes.length; si++) {
        const v = row[si] ?? 0;
        if (v === 0) continue;
        const strike = strikes[si]!;
        if (strike >= flip && v > 0) callP += v;
        else if (strike < flip && v < 0) putP += Math.abs(v);
      }
    }

    profiles.push({ flipStrike: flip, callPressure: callP, putPressure: putP });
  }

  return profiles;
}

/**
 * Compute the normalised intensity [0,1] for a pressure value given the max across the session.
 * Applies the power-curve gamma for perceptual scaling.
 */
function intensity(pressure: number, maxPressure: number): number {
  if (maxPressure <= 0 || pressure <= 0) return 0;
  const raw = Math.min(1, pressure / maxPressure);
  return Math.pow(raw, GAMMA);
}

/**
 * Map intensity [0,1] + RGB triple to an rgba() colour string.
 */
function zoneColor(rgb: readonly [number, number, number], inten: number): string {
  if (inten <= 0) return "rgba(0,0,0,0)";
  const alpha = MIN_ALPHA + inten * (MAX_ALPHA - MIN_ALPHA);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
}

/**
 * Turn a per-index array of axis coordinates into per-index [lo,hi] bands (same utility as
 * bandEdges in the heatmap paint, duplicated here to keep this module dependency-free).
 */
function bandEdges(coords: ReadonlyArray<number | null>): Array<Band | null> {
  const n = coords.length;
  const out: Array<Band | null> = new Array(n).fill(null);
  const resolved: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    if (c != null && Number.isFinite(c)) resolved.push(i);
  }
  if (resolved.length < 2) return out;

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

/**
 * Project the gamma surface onto drawable rects. Three zones per time column:
 *   - CALL zone: from the top of the neutral band to the top of the price range (gold)
 *   - NEUTRAL zone: a corridor around the flip level (teal)
 *   - PUT zone: from the bottom of the price range to the bottom of the neutral band (crimson)
 *
 * Zone intensity (alpha) scales with the aggregate GEX pressure in that zone — stronger walls
 * make the zone more vivid, dying walls fade it. The neutral band width is fixed (a fraction of
 * the visible price range) so it doesn't flicker with minute GEX changes.
 *
 * `xForTime` / `yForStrike`: chart's coordinate projections (injected for testability).
 * `flipAtTime`: returns the gamma flip level for a given time bucket.
 */
export function gammaSurfaceRects(
  grid: GexHeatmapGrid,
  xForTime: (time: number) => number | null,
  yForStrike: (strike: number) => number | null,
  flipAtTime: (time: number) => number | null
): SurfaceRect[] {
  const { times, strikes } = grid;
  if (!times.length || !strikes.length) return [];

  const profiles = buildColumnProfiles(grid, flipAtTime);
  if (!profiles.length) return [];

  // Global max pressure for normalisation — the strongest column across the session is alpha=MAX.
  const maxP = Math.max(
    ...profiles.map((p) => Math.max(p.callPressure, p.putPressure)),
    1e-12 // floor to avoid division by zero on empty grids
  );

  const xBands = bandEdges(times.map(xForTime));

  // Price range from the grid's strike extent.
  const priceLo = strikes[0]!;
  const priceHi = strikes[strikes.length - 1]!;
  const priceRange = priceHi - priceLo;
  const neutralHalf = priceRange * NEUTRAL_HALF_FRAC;

  // Smoothed flip across columns.
  let smoothedFlip = profiles[0]!.flipStrike;

  const out: SurfaceRect[] = [];

  for (let ti = 0; ti < times.length; ti++) {
    const xb = xBands[ti];
    if (!xb) continue;
    const prof = profiles[ti]!;

    // Exponential smoothing on the flip position so the neutral band flows.
    smoothedFlip = smoothedFlip * SMOOTH_ALPHA + prof.flipStrike * (1 - SMOOTH_ALPHA);

    const neutralTop = smoothedFlip + neutralHalf;
    const neutralBot = smoothedFlip - neutralHalf;

    // y coordinates (price axis is inverted: higher price = lower y).
    const yTop = yForStrike(priceHi);
    const yBot = yForStrike(priceLo);
    const yNeutralTop = yForStrike(neutralTop);
    const yNeutralBot = yForStrike(neutralBot);

    if (yTop == null || yBot == null || yNeutralTop == null || yNeutralBot == null) continue;

    const callI = intensity(prof.callPressure, maxP);
    const putI = intensity(prof.putPressure, maxP);
    // Neutral intensity: proportional to combined pressure (when both sides are strong, the
    // transition zone matters more) but capped below either side so it never dominates.
    const neutralI = Math.min(0.7, (callI + putI) * 0.5);

    // CALL zone: from chart top edge to neutral top boundary.
    if (callI > 0.01 && yNeutralTop > yTop) {
      out.push({
        x: xb.lo,
        y: yTop,
        w: xb.hi - xb.lo,
        h: yNeutralTop - yTop,
        color: zoneColor(CALL_RGB, callI),
      });
    }

    // NEUTRAL zone: the flip corridor.
    if (neutralI > 0.01 && yNeutralBot > yNeutralTop) {
      out.push({
        x: xb.lo,
        y: yNeutralTop,
        w: xb.hi - xb.lo,
        h: yNeutralBot - yNeutralTop,
        color: zoneColor(NEUTRAL_RGB, neutralI),
      });
    }

    // PUT zone: from neutral bottom boundary to chart bottom edge.
    if (putI > 0.01 && yBot > yNeutralBot) {
      out.push({
        x: xb.lo,
        y: yNeutralBot,
        w: xb.hi - xb.lo,
        h: yBot - yNeutralBot,
        color: zoneColor(PUT_RGB, putI),
      });
    }
  }

  return out;
}
