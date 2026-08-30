import type { Time } from "lightweight-charts";

/** Trailing whitespace when volume profile is off — bead bands stop before the price axis. */
export const VECTOR_BASE_RIGHT_OFFSET_BARS = 6;

/** Fixed pixel gutter when VP is on — stable separation on narrow SPX embed + mobile (bar-count offset varies).
 *  Reduced from 108 (2026-08-26, live member report): the profile bars were taking up a large,
 *  disproportionate share of the chart's width for what's meant to be an ambient background
 *  reference, not a competing foreground element. 64px still gives every bucket a legible width
 *  at typical desk zoom while leaving far more of the pane to the candles. */
export const VECTOR_VP_RIGHT_OFFSET_PX = 64;

/** @deprecated Prefer `vectorChartTimeScaleGutter` — bar offset alone is too narrow on phone embeds. */
export const VECTOR_VP_RIGHT_OFFSET_BARS = 18;

/** Pixel gap between the last candle and the start of volume-profile bars (member ref). */
export const VP_CANDLE_GAP_PX = 12;

/**
 * Hard cap on how wide the volume-profile bars are allowed to draw, independent of how much raw
 * whitespace sits between the last candle and the price axis.
 *
 * BUG FIXED (2026-08-26, live member report, screenshot on SPX): `volumeProfileGutter` sized the
 * bar band as ALL the whitespace to the right of the last candle, unconditionally. That whitespace
 * is NOT a fixed quantity — the time axis reserves a right-side gutter (`VECTOR_VP_RIGHT_OFFSET_PX`)
 * for the *time scale*, but the actual pixel gap between the last drawn candle and the price axis
 * varies with the chart's own zoom/fit state. Outside RTH (the reported case: "Market closed", the
 * session's last candle sitting well left of the price axis because the visible time window still
 * reserves room for a session that hasn't opened yet), that gap can be a large fraction of the
 * whole pane — the member's screenshot showed the profile block covering roughly a third of the
 * chart width. This is meant to be an ambient background reference, not a competing foreground
 * element, so its width must never scale with how much *unrelated* empty space happens to exist.
 * Capped independently of `VECTOR_VP_RIGHT_OFFSET_PX` (which only pins the time axis's own
 * right-side reserve, and is far too small a number to reuse as a drawing cap once whitespace
 * exceeds it — the whole point here is decoupling the two).
 */
export const VECTOR_VP_MAX_BAND_PX = 110;

export type VectorChartTimeScaleGutter =
  | { rightOffset: number; rightOffsetPixels?: undefined }
  | { rightOffsetPixels: number; rightOffset?: undefined };

export function vectorChartTimeScaleGutter(volumeProfileEnabled: boolean): VectorChartTimeScaleGutter {
  return volumeProfileEnabled
    ? { rightOffsetPixels: VECTOR_VP_RIGHT_OFFSET_PX }
    : { rightOffset: VECTOR_BASE_RIGHT_OFFSET_BARS };
}

/** @deprecated Use vectorChartTimeScaleGutter */
export function vectorChartRightOffsetBars(volumeProfileEnabled: boolean): number {
  return volumeProfileEnabled ? VECTOR_VP_RIGHT_OFFSET_BARS : VECTOR_BASE_RIGHT_OFFSET_BARS;
}

export type VolumeProfileGutter = {
  gutterLeft: number;
  rightX: number;
  maxBarWidth: number;
};

/**
 * Horizontal band for session volume profile bars — ONLY the whitespace to the right of the last
 * candle (same gutter model as the pin cone). Returns null when there is no honest room to draw.
 */
export function volumeProfileGutter(
  paneWidthPx: number,
  lastCandleXPx: number | null | undefined,
  rightPadPx = 2,
  minGapPx = VP_CANDLE_GAP_PX,
  minBandPx = 6,
  maxBandPx = VECTOR_VP_MAX_BAND_PX
): VolumeProfileGutter | null {
  if (!(paneWidthPx > 0)) return null;
  const rightX = paneWidthPx - rightPadPx;
  if (lastCandleXPx == null || !Number.isFinite(lastCandleXPx)) return null;
  const gutterLeft = lastCandleXPx + minGapPx;
  const rawBand = rightX - gutterLeft;
  if (!(rawBand > minBandPx)) return null;
  // Cap independently of how much whitespace actually exists — bars stay anchored to the price
  // axis on the right (rightX unchanged), so capping the band only pulls the LEFT edge of the
  // widest bar inward, never touches where bars sit relative to the axis.
  const band = maxBandPx > 0 ? Math.min(rawBand, maxBandPx) : rawBand;
  return { gutterLeft: rightX - band, rightX, maxBarWidth: band };
}

/** Map a bucket's relative volume (0..1) to a bar rectangle inside the gutter. */
export function volumeProfileBarRect(
  gutter: VolumeProfileGutter,
  volumeFrac: number
): { xLeft: number; width: number } | null {
  if (!(gutter.maxBarWidth > 0)) return null;
  const frac = Number.isFinite(volumeFrac) ? Math.max(0, Math.min(1, volumeFrac)) : 0;
  if (frac <= 0) return null;
  const width = Math.max(1, frac * gutter.maxBarWidth);
  let xLeft = gutter.rightX - width;
  if (xLeft < gutter.gutterLeft) xLeft = gutter.gutterLeft;
  return { xLeft, width: gutter.rightX - xLeft };
}

/** Last display bar time passed into the volume-profile primitive. */
export type VolumeProfileLastBarTime = Time | null;
