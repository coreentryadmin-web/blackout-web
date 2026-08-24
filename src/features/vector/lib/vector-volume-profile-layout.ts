import type { Time } from "lightweight-charts";

/** Trailing whitespace when volume profile is off — bead bands stop before the price axis. */
export const VECTOR_BASE_RIGHT_OFFSET_BARS = 6;

/** Fixed pixel gutter when VP is on — stable separation on narrow SPX embed + mobile (bar-count offset varies). */
export const VECTOR_VP_RIGHT_OFFSET_PX = 108;

/** @deprecated Prefer `vectorChartTimeScaleGutter` — bar offset alone is too narrow on phone embeds. */
export const VECTOR_VP_RIGHT_OFFSET_BARS = 18;

/** Pixel gap between the last candle and the start of volume-profile bars (member ref). */
export const VP_CANDLE_GAP_PX = 12;

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
  minBandPx = 6
): VolumeProfileGutter | null {
  if (!(paneWidthPx > 0)) return null;
  const rightX = paneWidthPx - rightPadPx;
  if (lastCandleXPx == null || !Number.isFinite(lastCandleXPx)) return null;
  const gutterLeft = lastCandleXPx + minGapPx;
  const band = rightX - gutterLeft;
  if (!(band > minBandPx)) return null;
  return { gutterLeft, rightX, maxBarWidth: band };
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
