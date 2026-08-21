import type { VectorDteHorizon } from "./vector-dte-horizon";

/**
 * Preset Vector chart intervals (minutes) — aggregated client-side from the 1m seed + live ticks.
 * 30m/60m are intraday roll-ups of the SAME session's 1m bars (a 6.5h RTH session → ~13 30m or
 * ~7 60m bars), so they need no extra data. Larger horizons (4h/1D/1W) are intentionally NOT
 * presets: they'd need a multi-day daily-bar feed we don't seed yet, and bucketing a single
 * session's 1m bars to 4h would collapse the whole day to 1–2 bars. Add those once the daily feed
 * lands. `VectorTimeframeMinutes` still accepts any custom whole-minute interval up to the max.
 */
export const VECTOR_PRESET_TIMEFRAMES = [1, 3, 5, 15, 30, 60] as const;

export type VectorPresetTimeframe = (typeof VECTOR_PRESET_TIMEFRAMES)[number];

/** Default candle interval on first paint (SPX Slayer embed + standalone /vector). */
export const VECTOR_DEFAULT_TIMEFRAME: VectorPresetTimeframe = 3;

/** Bead rows per side when a narrowed 0DTE horizon is active — wider than the 3m default (8) so the
 *  desk opens on more of the intraday rail than a tight spot cluster.
 *
 *  Was 12. Reduced to 10 (member-directed, 2026-08-09): 12 rows per side read as "painted" on a 3m
 *  0DTE chart, and 8 was felt to be too tight when it was the old value. 10 is the settled middle. */
export const VECTOR_0DTE_WALL_COUNT = 10;

/** Any whole-minute interval (presets + custom). */
export type VectorTimeframeMinutes = number;

export const VECTOR_INTERVAL_MIN = 1;
export const VECTOR_INTERVAL_MAX = 240;

/**
 * Max gamma-wall nodes per side the SERVER returns for Vector (double the global
 * DEFAULT_WALL_NODES_PER_SIDE = 6 that other products use). Higher candle timeframes show a
 * wider price range, so walls further from spot become relevant — the server must actually
 * return those further-out walls for the client to reveal them. The client never draws more
 * than this many per side; wallCountForTimeframe() picks how many of them to SHOW per timeframe.
 */
export const VECTOR_WALL_NODES_PER_SIDE = 20;

/**
 * How many wall nodes (guides + beads) to SHOW per side at a given candle timeframe. Higher
 * timeframe → wider visible price band → more, further-out walls are worth showing. Bounded by
 * VECTOR_WALL_NODES_PER_SIDE (the server cap) so we never ask to draw walls the server didn't
 * return. Monotonic non-decreasing in tf.
 *
 * The higher timeframes (30m/60m and custom 2h/4h) previously saturated at 12 alongside 15m, so a
 * 60m/4h chart — which spans a far wider price range — showed the same handful of near-spot walls
 * and left the top/bottom of the visible band bare. They now step up to 20 so the wider view fills
 * with the further-out walls that actually matter at that horizon (the server returns up to 20/side).
 */
export function wallCountForTimeframe(tf: VectorTimeframeMinutes): number {
  let count: number;
  // ── THE WALK STEPS UP (2026-08-19) ───────────────────────────────────────────────────────
  // Every row used to cost the same visual weight, because the bead swell was normalised against
  // each row's OWN peak — so a marginal level painted about as large as a dominant one (measured
  // separation on real SPX data: 1.26x). Under that rendering a low ceiling was the only defence
  // against a chart of uniform bars, and 6 rows on a 1m chart was the right call.
  //
  // The rail now normalises every row against ONE shared denominator (the frame's strongest wall,
  // see BOOK_SWELL_FLOOR), so a weak level recedes to a faint trace on its own. The dynamic range
  // does the decluttering, which is what lets a chart carry many more rows without turning to mush
  // — the reference implementation a member sent for comparison shows ~26 rows, of which perhaps
  // six are ever prominent. So the constraint that set these numbers is gone, and holding the old
  // ceiling now just hides structure a member could otherwise read at a glance.
  //
  // Manual NODES is unaffected and still overrides in both directions, up to the recorder's cap.
  // PARTIALLY WALKED BACK (2026-08-19, same day): 1m 10->8, 3m 14->11, 5m 16->13, 15m 18->16.
  //
  // The step-up earlier today was justified — a weak level now recedes to a faint trace, so rows
  // cost less than they used to. But it was sized without checking what it does to ROW SPACING, and
  // on a tight strike ladder that is the variable that matters: 14 rows per side put 22 rows on an
  // SPX 3m pane and took the median row gap from 26px to 17px.
  //
  // At 17px the geometry stops cooperating. BEAD_READABLE_MIN_HALF_PX floors every bead at 6.4px
  // thick, which is already 38% of the slot before the strength halo adds anything — so no amount
  // of thinning can make a 22-row SPX pane read cleanly, and trying is fighting the wrong variable.
  // Member: "I think the size needs to be reduced ?? its too thick imo".
  //
  // These counts keep most of the gain (still well above the pre-2026-08-19 6/10/10/12) while
  // returning ~21px of row gap on SPX 3m, which is where the thickness budget below can actually
  // bind instead of being pre-empted by the readability floor.
  if (tf <= 1) count = 8;
  else if (tf <= 3) count = Math.max(VECTOR_0DTE_WALL_COUNT, 11);
  else if (tf <= 5) count = 13;
  else if (tf <= 15) count = 16;
  else count = 20; // 30m+ — widest views saturate at the recorder cap
  return Math.max(1, Math.min(VECTOR_WALL_NODES_PER_SIDE, count));
}

/** Wall/bead row cap for the active DTE horizon — 0DTE on the SPX desk shows more of the rail. */
export function wallCountForHorizon(tf: VectorTimeframeMinutes, horizon: VectorDteHorizon): number {
  if (horizon === "0dte") {
    return Math.max(wallCountForTimeframe(tf), Math.min(VECTOR_WALL_NODES_PER_SIDE, VECTOR_0DTE_WALL_COUNT));
  }
  return wallCountForTimeframe(tf);
}

/**
 * Half-width (fraction of spot) of the "in view" strike band the KING ANCHOR considers at a given
 * candle timeframe. Scales UP with the timeframe so the anchor is timeframe-aware: a tight 1m view
 * anchors to the nearest strong wall (~±2%), while a wide 4h view (~±12%) lets a bigger, further-out
 * dominant wall become the anchor. Paired with `pickKingStrikes(walls, {spot, bandPct})`. Monotonic
 * non-decreasing in tf; the near-spot dominant-wall case (e.g. SPX today) anchors the same at every
 * timeframe because that wall is inside even the tightest band — which is correct, not a no-op.
 */
export function anchorBandPctForTimeframe(tf: VectorTimeframeMinutes): number {
  if (tf <= 1) return 0.02;
  if (tf <= 3) return 0.03;
  if (tf <= 5) return 0.04;
  if (tf <= 15) return 0.055;
  if (tf <= 30) return 0.07;
  if (tf <= 60) return 0.09;
  return 0.12; // 2h+ — widest view
}

export type VectorOhlcBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function isPresetTimeframe(minutes: number): minutes is VectorPresetTimeframe {
  return (VECTOR_PRESET_TIMEFRAMES as readonly number[]).includes(minutes);
}

export function normalizeVectorIntervalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 1;
  return Math.max(
    VECTOR_INTERVAL_MIN,
    Math.min(VECTOR_INTERVAL_MAX, Math.round(minutes))
  );
}

/** Bucket 1m bars into a higher interval (TradingView-style). Times are epoch seconds. */
export function aggregateVectorBars<T extends VectorOhlcBar>(
  bars: T[],
  intervalMinutes: number
): T[] {
  const interval = normalizeVectorIntervalMinutes(intervalMinutes);
  if (!bars.length || interval <= 1) return [...bars];
  const bucketSec = interval * 60;
  const map = new Map<number, T>();

  for (const bar of bars) {
    const key = Math.floor(bar.time / bucketSec) * bucketSec;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...bar, time: key } as T);
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      if (bar.volume != null && bar.volume > 0) {
        existing.volume = (existing.volume ?? 0) + bar.volume;
      }
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/**
 * Union two 1m bar arrays by time, sorted ascending. Fetched (Polygon closed)
 * bars are authoritative for OHLC — they replace live-built bars at the same
 * minute — but a live-built bar's volume survives when the fetched row has
 * none. Used by the SSE-reconnect backfill: bars that closed while the
 * connection was down (reconnect, replay window, tab sleep) are filled in
 * instead of remaining permanent session holes.
 */
export function mergeBarsByTime<T extends VectorOhlcBar & { volume?: number }>(
  existing: T[],
  fetched: T[]
): T[] {
  if (!fetched.length) return existing;
  const byTime = new Map<number, T>();
  for (const b of existing) byTime.set(b.time, b);
  for (const b of fetched) {
    const prev = byTime.get(b.time);
    byTime.set(
      b.time,
      prev && b.volume == null && prev.volume != null ? { ...b, volume: prev.volume } : b
    );
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}


