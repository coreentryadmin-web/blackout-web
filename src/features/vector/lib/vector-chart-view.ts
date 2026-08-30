import type { VectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";

/** Local mirror of VectorDailyChart's view union. Declared here rather than imported from the
 *  component so lib/ never depends on components/ — the cycle would be type-only and erased at
 *  build, but the layering inversion is real and would invite a runtime one later. */
type VectorHistoricalView = VectorDailyUnit | "4H";

/**
 * Default number of bars VISIBLE on first paint of the historical (1D/1W/4H) chart.
 *
 * WHY THIS EXISTS. The chart used to call `timeScale().fitContent()`, which forces every loaded
 * bar into the viewport. `daily-bars/route.ts` deliberately serves ~2 trading years (~500 daily
 * bars) because the 200-period SMA needs 200 of them — so fitContent squeezed ~500 candles into
 * roughly 900px: about 1.8px per candle, with the "1D" tab showing an x-axis spanning two years.
 * That is the "candles are too small to see" report, and it is a VIEWPORT problem, not a data one.
 *
 * The fix is to keep fetching the full history (the SMAs still need it) and only CHANGE what is
 * initially in view. Users pan/zoom out to reach the rest; nothing is removed.
 *
 * Counts are chosen so a candle lands at roughly 8-12px on a ~900px canvas, which is the range
 * where a body and both wicks are actually legible:
 *   1D  ~90 bars  → about 4.5 months of trading days
 *   1W  ~78 bars  → about 18 months
 *   4H  ~120 bars → about 30 trading days (6 bars/day)
 */
export function defaultVisibleBars(unit: VectorHistoricalView): number {
  if (unit === "4H") return 120;
  if (unit === "1W") return 78;
  return 90;
}

/**
 * The logical range to show on first paint: the most RECENT `defaultVisibleBars(unit)` bars.
 *
 * lightweight-charts logical coordinates are bar indices, and `to` is deliberately set one bar
 * PAST the last index so the newest candle is not glued to the right edge — traders read the most
 * recent bar constantly and a flush edge makes its wick ambiguous.
 *
 * Returns null when there is nothing to frame (no bars) or when the history is already shorter
 * than the target window — in that case the caller should fall back to fitContent(), because
 * pinning a range wider than the data would render dead space on the left.
 */
export function initialLogicalRange(
  barCount: number,
  unit: VectorHistoricalView
): { from: number; to: number } | null {
  if (!Number.isFinite(barCount) || barCount <= 0) return null;
  const want = defaultVisibleBars(unit);
  if (barCount <= want) return null;
  return { from: barCount - want, to: barCount + 1 };
}

/** Zoom presets offered as a second row under the 1D/1W/4H tabs. "ALL" means fitContent(). */
export const VECTOR_ZOOM_PRESETS = ["3M", "6M", "1Y", "ALL"] as const;
export type VectorZoomPreset = (typeof VECTOR_ZOOM_PRESETS)[number];

/**
 * Bars to frame for a zoom preset at a given view.
 *
 * Expressed in BARS rather than calendar time because lightweight-charts' logical range is bar
 * indices, and bar cadence differs per view: ~21 trading days/month on 1D, ~4.33 weeks/month on
 * 1W, ~6 bars/session on 4H. Returning null means "show everything" (ALL → fitContent).
 */
export function zoomPresetBars(preset: VectorZoomPreset, unit: VectorHistoricalView): number | null {
  if (preset === "ALL") return null;
  const months = preset === "3M" ? 3 : preset === "6M" ? 6 : 12;
  if (unit === "4H") return Math.round(months * 21 * 6);
  if (unit === "1W") return Math.round(months * 4.33);
  return Math.round(months * 21);
}

/**
 * Tickers with no share volume, so an empty volume histogram is CORRECT, not a data failure.
 *
 * SPX/NDX/RUT/VIX are indices — they have no shares and therefore no volume. The chart already
 * renders a HistogramSeries; on an index it simply has nothing to plot. Without this the empty
 * strip reads as broken, which is the kind of thing that gets reported as a bug and burns a
 * debugging session (it did — "volume histogram absent entirely" was written down as a gap).
 */
const INDEX_TICKERS = new Set(["SPX", "SPXW", "NDX", "RUT", "VIX", "XSP", "DJX"]);
export function isIndexTicker(ticker: string): boolean {
  return INDEX_TICKERS.has(String(ticker).trim().toUpperCase().replace(/^I:/, ""));
}

/** localStorage key for the remembered historical view. Versioned so a future shape change
 *  cannot resurrect a stale value that no longer parses. */
export const VECTOR_VIEW_STORAGE_KEY = "blackout.vector.historicalView.v1";
export const VECTOR_ZOOM_STORAGE_KEY = "blackout.vector.zoomPreset.v1";
/** Opt-in dark-pool price-level guides on the Vector chart pane. */
export const VECTOR_DARK_POOL_WALLS_STORAGE_KEY = "blackout.vector.darkPoolWalls.v1";

/** Read a persisted choice, returning `fallback` unless the stored value is one we still accept.
 *  Guards against a stale/ hand-edited value silently putting the chart into an invalid state. */
export function readPersisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
  } catch {
    return fallback; // private mode / storage disabled — never let this break the chart
  }
}

export function writePersisted(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — a lost preference is not worth an exception */
  }
}

/**
 * The strike nearest `price`, or null when the cursor is not meaningfully near one.
 *
 * Used to link the chart crosshair to the GEX ladder: hovering a price highlights the strike a
 * member would actually be reading at that level. Returns null past `tolerance` (a FRACTION of
 * price, so it scales across SPX at ~7,700 and a $3 stock) rather than snapping to the closest
 * strike no matter how far — a highlight that is always on tells the eye nothing, and on a wide
 * zoom the nearest strike can be hundreds of points away.
 *
 * Strikes are not assumed sorted; the ladder renders descending and other callers may not.
 */
export function nearestStrike(
  price: number | null | undefined,
  strikes: readonly number[],
  tolerance = 0.004
): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0 || !strikes.length) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of strikes) {
    if (!Number.isFinite(s)) continue;
    const d = Math.abs(s - price);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (best == null) return null;
  return bestDist / price <= tolerance ? best : null;
}
