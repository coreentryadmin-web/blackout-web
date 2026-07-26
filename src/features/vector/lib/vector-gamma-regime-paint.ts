/**
 * Pure paint/geometry layer for the dealer-gamma REGIME boundary glow — the part the canvas
 * primitive (`vector-gamma-regime-primitive.ts`) delegates to so the zone geometry, colours and
 * alpha ramps are unit-testable WITHOUT a DOM/canvas or a live chart.
 *
 * The dealer-gamma mechanic this visualises: the gamma FLIP is the price where NET dealer gamma
 * changes sign, so it is a REGIME BOUNDARY, not just a line:
 *  - Spot ABOVE the flip → dealers are LONG gamma → they hedge AGAINST moves → the tape PINS /
 *    mean-reverts → a CALM zone → a cool teal tint above the flip.
 *  - Spot BELOW the flip → dealers are SHORT gamma → they hedge WITH moves → the tape TRENDS / is
 *    unstable → a WARM amber tint below the flip.
 * Because the zones are fixed by the flip's geometry (calm above, unstable below), we always paint
 * teal upward and amber downward; SPOT only tells us which regime is CURRENTLY active, which we use
 * to brighten the side the market actually sits in (the inactive side is dimmed, never hidden).
 *
 * Why a localized boundary GLOW and not a full-pane wash: the price pane already carries a default-on
 * GEX heatmap surface (`vector-gex-heatmap-primitive.ts`, zOrder "bottom"). A second full wash would
 * muddy it, so this fades to zero alpha within a limited vertical extent each side of the flip — it
 * reads as a boundary glow hugging the flip line, leaving the heatmap and candles dominant.
 *
 * Kept dependency-light (no imports) so it stays deterministic and pure.
 */

/** Long-gamma / calm zone — teal, matched to the cool end of the desk palette (rgba(45,212,191)). */
export const LONG_GAMMA_RGB = "45, 212, 191";
/** Short-gamma / unstable zone — amber, matched to the warm end (rgba(251,146,60)). */
export const SHORT_GAMMA_RGB = "251, 146, 60";

/** How far (px) the glow reaches each side of the flip before it decays to fully transparent. */
export const GAMMA_REGIME_EXTENT_PX = 52;
/**
 * Peak alpha AT the flip line for the ACTIVE regime. Kept deliberately low so the candles, wall
 * beads and the underlying GEX heatmap all stay dominant — this is an ambience cue, not a fill.
 */
export const GAMMA_REGIME_PEAK_ALPHA = 0.12;
/** The side the market is NOT currently in is dimmed to this fraction of the peak (present, muted). */
const DIM_FACTOR = 0.55;

/** The two-word posture label for a regime side (drawn near the flip when the primitive opts in). */
export function regimePostureLabel(aboveFlip: boolean): "LONG γ" | "SHORT γ" {
  return aboveFlip ? "LONG γ" : "SHORT γ";
}

export type GammaRegimeZone = {
  /** long = calm/pinned (above the flip); short = unstable/trending (below the flip). */
  posture: "long" | "short";
  label: "LONG γ" | "SHORT γ";
  /** Bare "r, g, b" triple so the renderer can compose `rgba(rgb, α)` at any alpha. */
  rgb: string;
  /** Alpha at the flip line for this side; the gradient decays it to 0 at the extent edge. */
  peakAlpha: number;
  /** True when SPOT currently sits in this regime (drives the brighter-active emphasis). */
  active: boolean;
};

export type GammaRegimeGeometry = {
  /** y-coordinate (media px) of the flip price on the candle price scale. */
  flipY: number;
  extentPx: number;
  /** Top of the glow (calm side edge, fully transparent). */
  topY: number;
  /** Bottom of the glow (unstable side edge, fully transparent). */
  bottomY: number;
  /** Calm / long-gamma zone (above the flip). */
  above: GammaRegimeZone;
  /** Unstable / short-gamma zone (below the flip). */
  below: GammaRegimeZone;
};

/**
 * Resolve the boundary-glow geometry from the flip price, its y-coordinate and the live spot.
 * Returns null — draw NOTHING — whenever the flip is null/not finite or its coordinate is unavailable
 * (honest absence: a regime we can't place is never fabricated). Spot may be null (off-hours / no
 * tick yet): the boundary still reads, we just paint both sides equally since we can't confirm a
 * side.
 */
export function gammaRegimeGeometry(input: {
  flip: number | null;
  spot: number | null;
  flipY: number | null;
  extentPx?: number;
  peakAlpha?: number;
}): GammaRegimeGeometry | null {
  const { flip, spot } = input;
  const extentPx = input.extentPx ?? GAMMA_REGIME_EXTENT_PX;
  const peakAlpha = input.peakAlpha ?? GAMMA_REGIME_PEAK_ALPHA;
  if (flip == null || !Number.isFinite(flip)) return null;
  if (input.flipY == null || !Number.isFinite(input.flipY)) return null;
  if (!(extentPx > 0) || !(peakAlpha > 0)) return null;
  const flipY = input.flipY;

  // Which regime spot currently sits in. Spot AT-OR-ABOVE the flip = dealers long gamma = calm.
  const hasSpot = spot != null && Number.isFinite(spot);
  const aboveFlip = hasSpot ? (spot as number) >= flip : null;
  const dim = peakAlpha * DIM_FACTOR;
  // Active side glows at full peak; inactive side is dimmed; with no spot, both are equal.
  const aboveAlpha = aboveFlip == null ? peakAlpha : aboveFlip ? peakAlpha : dim;
  const belowAlpha = aboveFlip == null ? peakAlpha : aboveFlip ? dim : peakAlpha;

  return {
    flipY,
    extentPx,
    topY: flipY - extentPx,
    bottomY: flipY + extentPx,
    above: {
      posture: "long",
      label: "LONG γ",
      rgb: LONG_GAMMA_RGB,
      peakAlpha: aboveAlpha,
      active: aboveFlip === true,
    },
    below: {
      posture: "short",
      label: "SHORT γ",
      rgb: SHORT_GAMMA_RGB,
      peakAlpha: belowAlpha,
      active: aboveFlip === false,
    },
  };
}

/**
 * Colour stops for one zone's linear gradient. The gradient runs along the zone's own extent; the
 * peak alpha sits at the FLIP line and decays to 0 at the outer edge, so the glow hugs the boundary:
 *  - "above": gradient from the top edge (transparent) DOWN to the flip (peak).
 *  - "below": gradient from the flip (peak) DOWN to the bottom edge (transparent).
 */
export function zoneGradientStops(
  zone: GammaRegimeZone,
  side: "above" | "below"
): ReadonlyArray<{ offset: number; color: string }> {
  const peak = `rgba(${zone.rgb}, ${round3(zone.peakAlpha)})`;
  const fade = `rgba(${zone.rgb}, 0)`;
  return side === "above"
    ? [
        { offset: 0, color: fade },
        { offset: 1, color: peak },
      ]
    : [
        { offset: 0, color: peak },
        { offset: 1, color: fade },
      ];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
