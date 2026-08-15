import type { IntradayZoomPreset } from "@/features/vector/lib/vector-candle-render";

/** Compare desk broadcasts crosshair + visible range by session epoch seconds. */
export type VectorCompareCrosshairSync = {
  sourceId: string;
  timeSec: number | null;
  tick: number;
};

export type VectorCompareRangeSync = {
  sourceId: string;
  fromSec: number;
  toSec: number;
  tick: number;
};

/** Command-bar zoom preset broadcast — all panes apply Session/Structure/Live together. */
export type VectorCompareZoomPresetSync = {
  preset: IntradayZoomPreset;
  tick: number;
};

export type VectorCompareChartSyncBind = {
  paneId: string;
  linkCrosshair: boolean;
  linkZoom: boolean;
  crosshair: VectorCompareCrosshairSync | null;
  visibleRange: VectorCompareRangeSync | null;
  zoomPreset: VectorCompareZoomPresetSync | null;
};

/** Close price at or before a unix-second cursor (for setCrosshairPosition). */
export function barCloseAtOrBeforeTime(
  bars: readonly { time: number; close: number }[],
  timeSec: number
): number | null {
  let close: number | null = null;
  for (const b of bars) {
    if (b.time <= timeSec) close = b.close;
    else break;
  }
  return close;
}

/** lightweight-charts Time → unix seconds when the scale is intraday numeric. */
export function horzTimeToEpochSec(time: unknown): number | null {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  return null;
}

export function visibleRangeToEpochSec(range: {
  from: unknown;
  to: unknown;
}): { fromSec: number; toSec: number } | null {
  const fromSec = horzTimeToEpochSec(range.from);
  const toSec = horzTimeToEpochSec(range.to);
  if (fromSec == null || toSec == null || fromSec >= toSec) return null;
  return { fromSec, toSec };
}
