import {
  VECTOR_PRESET_TIMEFRAMES,
  type VectorTimeframeMinutes,
} from "@/features/vector/lib/vector-bar-timeframes";
import { isRthBarSec } from "@/features/vector/lib/vector-session-hours";

/** Brand candle bodies — match VectorChart / institutional palette. */
export const VECTOR_CANDLE_UP = "#a3e635";
export const VECTOR_CANDLE_DOWN = "#ff2d55";
/** Slightly darker borders so bodies stay legible when zoomed out. */
export const VECTOR_CANDLE_BORDER_UP = "#84cc16";
export const VECTOR_CANDLE_BORDER_DOWN = "#e11d48";

/** Default horizontal spacing on session overview / first paint (~8px bodies on ~900px canvas). */
export const VECTOR_SESSION_BAR_SPACING = 8;
/** Floor — lightweight-charts default 0.5px collapses candles to hairlines when zoomed out. */
export const VECTOR_MIN_BAR_SPACING = 3.5;
/** Ceiling when zoomed in on a tight window. */
export const VECTOR_MAX_BAR_SPACING = 22;

/** Last N display bars for the "Structure" zoom preset (≈75 min at 1m, scales with aggregation). */
export const VECTOR_STRUCTURE_ZOOM_BARS = 75;
/** Trailing window for "Live" edge follow preset. */
export const VECTOR_LIVE_ZOOM_BARS = 48;

/** Body alpha for extended-hours candles when the seed includes pre/post-market bars. */
export const VECTOR_EXTENDED_HOURS_ALPHA = 0.34;

export type CandlestickBarInput = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type CandlestickDisplayBar = CandlestickBarInput & {
  color?: string;
  borderColor?: string;
  wickColor?: string;
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** True when any bar in the series falls outside 09:30–16:00 ET RTH. */
export function hasExtendedHoursBars(bars: readonly { time: number }[]): boolean {
  for (const bar of bars) {
    if (Number.isFinite(bar.time) && !isRthBarSec(bar.time)) return true;
  }
  return false;
}

/**
 * Per-bar candle colors: RTH bars use series defaults; extended-hours bars render at lower
 * opacity so the regular session pops on full-day / session-overview views.
 */
export function toCandlestickDisplayData<T extends CandlestickBarInput>(
  bars: readonly T[]
): CandlestickDisplayBar[] {
  if (!bars.length || !hasExtendedHoursBars(bars)) return [...bars];
  return bars.map((bar) => {
    if (!Number.isFinite(bar.time) || isRthBarSec(bar.time)) return bar;
    const up = bar.close >= bar.open;
    const body = hexToRgba(up ? VECTOR_CANDLE_UP : VECTOR_CANDLE_DOWN, VECTOR_EXTENDED_HOURS_ALPHA);
    const border = hexToRgba(
      up ? VECTOR_CANDLE_BORDER_UP : VECTOR_CANDLE_BORDER_DOWN,
      VECTOR_EXTENDED_HOURS_ALPHA * 0.9
    );
    return { ...bar, color: body, borderColor: border, wickColor: body };
  });
}

/** Volume histogram alpha — dim extended-hours bars to match candle treatment. */
export function volumeAlphaForBar(timeSec: number, extendedHoursPresent: boolean): number {
  if (!extendedHoursPresent || !Number.isFinite(timeSec) || isRthBarSec(timeSec)) return 0.72;
  return 0.26;
}

/** Shared candlestick series styling for Vector intraday + historical charts. */
export function vectorCandlestickOptions() {
  return {
    upColor: VECTOR_CANDLE_UP,
    downColor: VECTOR_CANDLE_DOWN,
    borderVisible: true,
    borderUpColor: VECTOR_CANDLE_BORDER_UP,
    borderDownColor: VECTOR_CANDLE_BORDER_DOWN,
    wickUpColor: VECTOR_CANDLE_UP,
    wickDownColor: VECTOR_CANDLE_DOWN,
    wickVisible: true,
  } as const;
}

/** Initial time-scale spacing — session load uses VECTOR_SESSION_BAR_SPACING via applySessionBarSpacing. */
export function vectorTimeScaleSpacingOptions() {
  return {
    barSpacing: VECTOR_SESSION_BAR_SPACING,
    minBarSpacing: VECTOR_MIN_BAR_SPACING,
    maxBarSpacing: VECTOR_MAX_BAR_SPACING,
  } as const;
}

export type LogicalRangeLike = { from: number; to: number } | null | undefined;

/** Visible bar count from a lightweight-charts logical range (inclusive-ish). */
export function visibleBarCountFromRange(range: LogicalRangeLike): number | null {
  if (!range) return null;
  const from = Number(range.from);
  const to = Number(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const count = Math.ceil(to - from);
  return count > 0 ? count : null;
}

/**
 * Dim background overlays (heatmap, volume profile, regime glow, bead rail) when the member zooms
 * out so candles stay the focal layer. Full opacity at ≤90 visible bars; ~38% at ≥400.
 */
export function overlayDimFactor(visibleBars: number): number {
  if (visibleBars <= 90) return 1;
  if (visibleBars >= 400) return 0.38;
  const t = (visibleBars - 90) / (400 - 90);
  return 1 - t * (1 - 0.38);
}

/**
 * Nudge bar spacing when zoomed in (few bars → wider spacing) while respecting min/max bounds.
 * Zoom-out floor is enforced by minBarSpacing; this mainly widens the view when studying structure.
 */
export function adaptiveBarSpacingForZoom(visibleBars: number): {
  barSpacing: number;
  minBarSpacing: number;
} {
  if (visibleBars <= 40) {
    return { barSpacing: Math.min(VECTOR_MAX_BAR_SPACING, 14), minBarSpacing: VECTOR_MIN_BAR_SPACING };
  }
  if (visibleBars <= 90) {
    return { barSpacing: VECTOR_SESSION_BAR_SPACING, minBarSpacing: VECTOR_MIN_BAR_SPACING };
  }
  return { barSpacing: Math.max(VECTOR_MIN_BAR_SPACING, 5), minBarSpacing: VECTOR_MIN_BAR_SPACING };
}

/** Logical range framing the newest session (delegates shape to viewport helper consumers). */
export function structureVisibleLogicalRange(
  barCount: number,
  structureBars = VECTOR_STRUCTURE_ZOOM_BARS
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  const want = Math.min(structureBars, barCount);
  return { from: barCount - want, to: barCount + 1 };
}

/** Trailing live-edge window — newest N bars with right breathing room. */
export function liveEdgeVisibleLogicalRange(
  barCount: number,
  liveBars = VECTOR_LIVE_ZOOM_BARS
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  const want = Math.min(liveBars, barCount);
  return { from: barCount - want, to: barCount + 1 };
}

/**
 * When zoomed far out on a fine interval, step up to the next preset timeframe so bodies stay
 * readable. Returns null when no change is warranted. Effective bar count is measured in 1m units.
 */
export function coarserTimeframeIfZoomedOut(
  visibleBars: number,
  intervalMinutes: VectorTimeframeMinutes
): VectorTimeframeMinutes | null {
  const interval = Math.max(1, Math.round(intervalMinutes));
  const effective1m = visibleBars * interval;
  if (effective1m < 300) return null;
  const presets = VECTOR_PRESET_TIMEFRAMES;
  let idx = presets.findIndex((p) => p >= interval);
  if (idx < 0) idx = presets.length - 1;
  if (idx >= presets.length - 1) return null;
  const next = presets[idx + 1]!;
  return next === interval ? null : next;
}

export type IntradayZoomPreset = "session" | "structure" | "live";
