import type { HistogramData, Time } from "lightweight-charts";
import { volumeAlphaForBar } from "@/features/vector/lib/vector-candle-render";

/** How the lower volume pane paints bars. */
export const VECTOR_VOLUME_MODES = ["relative", "pressure", "direction"] as const;
export type VectorVolumeMode = (typeof VECTOR_VOLUME_MODES)[number];

export const VECTOR_VOLUME_MODE_STORAGE_KEY = "blackout.vector.volumeMode.v1";

/** Rolling window for relative-volume (RVOL) coloring — one session day at 1m ≈ 390 bars. */
export const VECTOR_VOLUME_RVOL_PERIOD = 20;

export type VolumeBarInput = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

const VOLUME_UP_BASE = "#00e676";
const VOLUME_DOWN_BASE = "#ff2d55";

/** Quiet participation — below average. */
const RVOL_DIM = "rgba(161, 161, 170, 0.38)";
/** Near the rolling mean. */
const RVOL_BASE = "rgba(56, 189, 248, 0.62)";
/** Above-average participation — move may be real. */
const RVOL_HIGH = "rgba(34, 211, 238, 0.82)";
/** Climax / spike bar — often marks exhaustion or initiation. */
const RVOL_CLIMAX = "rgba(251, 191, 36, 0.92)";

const PRESSURE_BUY = "#00e676";
const PRESSURE_SELL = "#ff2d55";

export function isVectorVolumeMode(v: unknown): v is VectorVolumeMode {
  return typeof v === "string" && (VECTOR_VOLUME_MODES as readonly string[]).includes(v);
}

export function volumeModeLabel(mode: VectorVolumeMode): string {
  if (mode === "relative") return "RVOL";
  if (mode === "pressure") return "Pressure";
  return "Direction";
}

function volumeColor(baseHex: string, alpha: number): string {
  const r = parseInt(baseHex.slice(1, 3), 16);
  const g = parseInt(baseHex.slice(3, 5), 16);
  const b = parseInt(baseHex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Simple trailing SMA over positive volumes only (null until `period` samples exist). */
export function volumeTrailingSma(
  volumes: readonly (number | null | undefined)[],
  period: number
): (number | null)[] {
  if (period < 1) return volumes.map(() => null);
  const out: (number | null)[] = [];
  const window: number[] = [];
  let sum = 0;
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    if (v != null && v > 0) {
      window.push(v);
      sum += v;
      if (window.length > period) sum -= window.shift()!;
    }
    out.push(window.length >= period ? sum / period : null);
  }
  return out;
}

/**
 * Estimated buy-side share of bar volume from where price closed inside the range.
 * Flat bars (high === low) → 0.5 (honest unknown, not fabricated direction).
 */
export function barBuyPressureRatio(bar: Pick<VolumeBarInput, "high" | "low" | "close">): number {
  const range = bar.high - bar.low;
  if (!(range > 0)) return 0.5;
  const raw = (bar.close - bar.low) / range;
  return Math.max(0, Math.min(1, raw));
}

function rvolColor(rvol: number): string {
  if (rvol < 0.7) return RVOL_DIM;
  if (rvol < 1.3) return RVOL_BASE;
  if (rvol < 2) return RVOL_HIGH;
  return RVOL_CLIMAX;
}

function pressureColor(buyRatio: number, alpha: number): string {
  if (buyRatio >= 0.5) {
    const t = (buyRatio - 0.5) * 2;
    return volumeColor(PRESSURE_BUY, 0.35 + t * (alpha - 0.35));
  }
  const t = (0.5 - buyRatio) * 2;
  return volumeColor(PRESSURE_SELL, 0.35 + t * (alpha - 0.35));
}

function histogramColor(
  bar: VolumeBarInput,
  mode: VectorVolumeMode,
  alpha: number,
  rvol: number | null
): string {
  if (mode === "relative") {
    if (rvol == null) return RVOL_BASE;
    return rvolColor(rvol);
  }
  if (mode === "pressure") return pressureColor(barBuyPressureRatio(bar), alpha);
  const up = bar.close >= bar.open;
  return volumeColor(up ? VOLUME_UP_BASE : VOLUME_DOWN_BASE, alpha);
}

/** Session volume histogram — height is always raw share volume; color encodes the selected mode. */
export function volumeHistogramData(
  bars: readonly VolumeBarInput[],
  mode: VectorVolumeMode,
  extendedHoursPresent: boolean
): HistogramData<Time>[] {
  const vols = bars.map((b) => (b.volume != null && b.volume > 0 ? b.volume : null));
  const sma = volumeTrailingSma(vols, VECTOR_VOLUME_RVOL_PERIOD);
  const out: HistogramData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const value = bar.volume;
    if (value == null || value <= 0) continue;
    const alpha = volumeAlphaForBar(bar.time, extendedHoursPresent);
    const avg = sma[i];
    const rvol = avg != null && avg > 0 ? value / avg : null;
    out.push({
      time: bar.time as Time,
      value,
      color: histogramColor(bar, mode, alpha, rvol),
    });
  }
  return out;
}

/** 20-bar volume average line — only meaningful in RVOL mode; same scale as the histogram. */
export function volumeAverageLineData(
  bars: readonly VolumeBarInput[],
  period = VECTOR_VOLUME_RVOL_PERIOD
): { time: Time; value: number }[] {
  const vols = bars.map((b) => (b.volume != null && b.volume > 0 ? b.volume : null));
  const sma = volumeTrailingSma(vols, period);
  const out: { time: Time; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const avg = sma[i];
    if (avg == null || !(avg > 0)) continue;
    out.push({ time: bars[i]!.time as Time, value: avg });
  }
  return out;
}
