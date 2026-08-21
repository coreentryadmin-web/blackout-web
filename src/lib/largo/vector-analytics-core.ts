/**
 * VECTOR CHART ANALYTICS — the pure composition layer.
 *
 * WHY THIS EXISTS. Nine of Vector's analytics are computed IN THE BROWSER from the drawn candles
 * and the universe snapshot: volume profile, market structure (HH/LH/HL/LL + BOS/CHoCH), the
 * auto-fib dominant swing, the key-level groups (HOD/LOD, opening range, session fib, prior-day,
 * floor pivots), the OpEx calendar, the daily dealer-regime overlay, the screener and the ticker
 * comparison strip. Largo had `get_vector_full_state` (walls/flip/magnet/play/technicals) and
 * `get_vector_pulse` (what changed), and NONE of these — so "where's the point of control on NVDA",
 * "did SPX break structure", "what's the golden pocket", "where are today's floor pivots", "when is
 * the next OpEx", "which names are nearest their flip" were structurally unanswerable, and Largo
 * did not know that. It answered from adjacent data in the same confident voice.
 *
 * Same root cause as Vector Pulse, the Helix derivations and the helix-signal-outcomes cron: a real
 * capability with no path to the answering layer. That recurring pattern, not any one panel, is the
 * bug this closes.
 *
 * EVERY NUMBER COMES FROM THE REAL PRODUCTION FUNCTION — `computeVolumeProfile`, `labelPivots`,
 * `detectStructureEvents`, `dominantSwing`/`swingRetracement`/`goldenPocket`, `levelLinesFor`,
 * `lastSessionBars`, `aggregateVectorBars`. Nothing here re-derives a level. Reimplementing any of
 * them would drift the moment a threshold is tuned, and Largo would then describe a chart that does
 * not match the one on screen — a disagreement no test would catch and every member would see.
 *
 * PURE AND TOTAL: no IO, no clock beyond what the caller passes, no throw. The server wrapper
 * (`vector-analytics.ts`) does the fetching; this file does the composition, so it stays testable
 * under a plain `tsx --test` import. Same core/server split as vector-server-technicals-core.ts.
 */

import { aggregateVectorBars } from "@/features/vector/lib/vector-bar-timeframes";
import { computeVolumeProfile, type VolumeProfileBar } from "@/features/vector/lib/vector-volume-profile";
import {
  labelPivots,
  detectStructureEvents,
  type StructureBar,
} from "@/features/vector/lib/vector-market-structure";
import {
  dominantSwing,
  swingRetracement,
  goldenPocket,
  GOLDEN_POCKET_RATIOS,
} from "@/features/vector/lib/vector-fib-swing";
import {
  lastSessionBars,
  levelLinesFor,
  type LevelBar,
  type PriorDayOhlc,
} from "@/features/vector/lib/vector-key-levels";
import { opexDatesInRange, isQuarterlyOpex } from "@/features/vector/lib/vector-opex";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";

/**
 * The chart's own fractal half-width for structure and the auto-fib swing. Both call sites in the
 * product pass 3 (`buildStructureMarkers(bars, 3)` in VectorChart.tsx; `dominantSwing(bars, 3, …)`
 * in `levelLinesFor`'s `fib-auto` branch), so Largo passes 3 too — a different k would label a
 * different set of pivots than the member is looking at.
 */
export const VECTOR_PIVOT_K = 3;

/**
 * Minimum swing size for the auto-fib, as a fraction of price — the chart's exact floor
 * (`ref * 0.0015` in `levelLinesFor`). Below it we report NO swing rather than a hairline pocket
 * clinging to spot.
 */
export const VECTOR_SWING_MIN_RANGE_PCT = 0.0015;

/** Row caps. This is a read for an LLM to reason over, not a chart buffer to redraw. */
const MAX_PIVOTS = 12;
const MAX_EVENTS = 8;
const MAX_BUCKETS = 8;

export type VectorBarAnalyticsBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Matches `VectorSeedBar`'s optional-not-nullable volume so the seed bars satisfy this
   *  structurally and `aggregateVectorBars` (which requires `number | undefined`) accepts it. */
  volume?: number;
};

export type VectorBarAnalyticsOptions = {
  /** Chart timeframe in minutes. Structure and the auto-fib are read off the AGGREGATED bars. */
  timeframeMin?: number;
  /** Live price; falls back to the last close for the swing-size floor. */
  spot?: number | null;
  /** Member-configurable opening-range window; 15 is the product default. */
  openingRangeMinutes?: number;
};

/**
 * Prior-session OHLC, derived with the SAME session splitter the chart uses.
 *
 * `lastSessionBars` peels the newest ET day; applying it again to what remains peels the one before
 * it. Reusing the production splitter twice is deliberate — the alternative (a local
 * "group bars by date" loop) would be a second, subtly different notion of where a session begins,
 * and the floor pivots derived from it would then disagree with the chart's.
 *
 * Returns null when the seed window holds only one session: pivots computed from a partial or
 * absent prior day would be confidently wrong, which is worse than absent.
 */
export function priorSessionOhlc(bars: readonly VectorBarAnalyticsBar[]): PriorDayOhlc | null {
  if (!bars.length) return null;
  const today = lastSessionBars(bars);
  const rest = bars.slice(0, bars.length - today.length);
  if (!rest.length) return null;
  const prior = lastSessionBars(rest);
  if (!prior.length) return null;

  let pdh = -Infinity;
  let pdl = Infinity;
  for (const b of prior) {
    if (Number.isFinite(b.high) && b.high > pdh) pdh = b.high;
    if (Number.isFinite(b.low) && b.low < pdl) pdl = b.low;
  }
  const pdc = prior[prior.length - 1]!.close;
  if (!Number.isFinite(pdh) || !Number.isFinite(pdl) || !Number.isFinite(pdc)) return null;
  return { pdh, pdl, pdc };
}

export type VectorBarAnalytics = ReturnType<typeof computeVectorBarAnalytics>;

/**
 * Compose every bar-derived Vector analytic from ONE set of 1-minute bars.
 *
 * Returns null on no bars — "we have no chart to read" is a different answer from "the chart shows
 * nothing", and only the caller can phrase the first honestly.
 */
/**
 * ET anchor for a chart time, so a structure pivot or break never reaches the model as a bare
 * integer it has to interpret.
 *
 * WHY. `market_structure` is assembled from `fetchVectorSeedBars`, which seeds THREE sessions, so
 * its pivots and BOS/CHoCH events genuinely span several days — measured live on SPX, one scan
 * returned events at both 2026-08-19 15:30 ET and 2026-08-20 15:30 ET. The tool description tells
 * the reader "latest_event is the live one", and every one of those times was served as a bare
 * epoch with nothing on the object saying which session it belonged to. A reader that assumes the
 * set is "today" dates a PRIOR-session break as today's — the same off-by-one-session failure
 * #2418 fixed for OHLC bars, on the panel whose entire job is "did structure break, and when".
 *
 * The units are a second hazard: these are epoch SECONDS (lightweight-charts' convention), and a
 * reader that takes them for milliseconds lands in January 1970.
 *
 * `session_date` is safe to state here because Vector's structure runs on RTH session bars, so a
 * bar's ET calendar date IS its session. Returns nothing when the time is unreadable rather than
 * inventing a date — `etStamp` refuses non-positive and non-finite input for exactly that reason.
 */
function etAnchor(timeSec: number): { et?: string; session_date?: string } {
  // *1000: the helper takes epoch MILLIseconds; chart times are seconds.
  const ms = typeof timeSec === "number" && Number.isFinite(timeSec) && timeSec > 0 ? timeSec * 1000 : NaN;
  const et = etStamp(ms);
  const session_date = etSessionDate(ms);
  return et && session_date ? { et, session_date } : {};
}

export function computeVectorBarAnalytics(
  minuteBars: readonly VectorBarAnalyticsBar[],
  opts: VectorBarAnalyticsOptions = {}
) {
  if (!minuteBars.length) return null;

  const timeframeMin = opts.timeframeMin ?? 5;
  const openingRangeMinutes = opts.openingRangeMinutes ?? 15;

  // The chart draws AGGREGATED bars, and structure/auto-fib are read off what is drawn. Volume
  // profile is the exception: VectorChart.tsx feeds it the raw MINUTE bars
  // (`computeVolumeProfile(minuteBarsRef.current)`), because bucketing a coarser bar smears its
  // whole volume across one high-low band and moves the POC.
  const agg = aggregateVectorBars([...minuteBars], timeframeMin) as VectorBarAnalyticsBar[];
  const ref = opts.spot ?? minuteBars[minuteBars.length - 1]!.close;

  // ── VOLUME PROFILE ──────────────────────────────────────────────────────────────────────────
  const profile = computeVolumeProfile(minuteBars as readonly VolumeProfileBar[]);
  const topBuckets = [...profile.buckets]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_BUCKETS)
    .map((b) => ({ price: b.price, volume: b.volume }));

  // ── MARKET STRUCTURE ────────────────────────────────────────────────────────────────────────
  const structureBars = agg as readonly StructureBar[];
  const pivots = labelPivots(structureBars, VECTOR_PIVOT_K);
  const events = detectStructureEvents(structureBars, VECTOR_PIVOT_K);
  const lastEvent = events.length ? events[events.length - 1]! : null;

  // ── AUTO-FIB DOMINANT SWING ─────────────────────────────────────────────────────────────────
  const swing = dominantSwing(agg, VECTOR_PIVOT_K, ref > 0 ? ref * VECTOR_SWING_MIN_RANGE_PCT : 0);
  const pocket = swing ? goldenPocket(swing) : null;

  // ── KEY LEVELS ──────────────────────────────────────────────────────────────────────────────
  // Each group goes through `levelLinesFor`, the same composer the chart's level toggles call, so
  // a member reading "OR-H 15m" on screen and Largo quoting it are reading one function.
  const levelBars = agg as unknown as LevelBar[];
  const priorDay = priorSessionOhlc(minuteBars);
  const linesFor = (id: Parameters<typeof levelLinesFor>[0]) =>
    levelLinesFor(id, levelBars, priorDay, openingRangeMinutes).map((l) => ({
      key: l.key,
      label: l.label,
      price: l.price,
    }));

  return {
    timeframe_min: timeframeMin,
    bars_analyzed: minuteBars.length,
    aggregated_bars: agg.length,
    reference_price: ref,

    /** VOLUME PROFILE — POC and the ~70% value area over the seeded minute bars. */
    volume_profile: {
      poc: profile.poc,
      value_area_low: profile.valueAreaLow,
      value_area_high: profile.valueAreaHigh,
      bucket_size: profile.bucketSize,
      total_volume: profile.totalVolume,
      /** Heaviest buckets first — a POC needs its runners-up to say how peaked it is. */
      top_buckets: topBuckets,
      /** SPX has no native volume; the chart aligns SPY 1m volume onto SPX bars. Zero total means
       *  no volume was available at all, NOT a session with no trading — say which. */
      empty_reason: profile.totalVolume > 0 ? null : "no_volume_on_bars",
    },

    /** MARKET STRUCTURE — labelled fractal pivots and the breaks between them. */
    market_structure: {
      pivot_k: VECTOR_PIVOT_K,
      /** Most recent last — a structure read is a sequence, and the tail is the live part. */
      pivots: pivots.slice(-MAX_PIVOTS).map((p) => ({
        time: p.time,
        ...etAnchor(p.time),
        price: p.price,
        kind: p.kind,
        label: p.label,
      })),
      events: events.slice(-MAX_EVENTS).map((e) => ({
        time: e.time,
        ...etAnchor(e.time),
        level: e.level,
        type: e.type,
        direction: e.direction,
      })),
      /** BOS = continuation, CHOCH = character change. The distinction is the whole read; a
       *  "broke a level" summary that collapses them loses the only actionable part. */
      latest_event: lastEvent
        ? {
            time: lastEvent.time,
            ...etAnchor(lastEvent.time),
            level: lastEvent.level,
            type: lastEvent.type,
            direction: lastEvent.direction,
          }
        : null,
    },

    /** AUTO-FIB — the DOMINANT swing of the displayed window, not the last noise wiggle. */
    fib_swing: swing
      ? {
          direction: swing.direction,
          high: swing.high,
          low: swing.low,
          from_time: swing.from.time,
          to_time: swing.to.time,
          retracements: [0.382, 0.5, 0.618, 0.786].map((ratio) => ({
            ratio,
            price: swingRetracement(swing, ratio),
          })),
          golden_pocket: pocket ? { top: pocket.top, bottom: pocket.bottom, ratios: [...GOLDEN_POCKET_RATIOS] } : null,
        }
      : null,
    /** Absent because no swing cleared the 0.15%-of-price floor — NOT because none was looked for. */
    fib_swing_empty_reason: swing ? null : "no_swing_above_min_range",

    /** KEY LEVELS — the five chart level groups, each from `levelLinesFor`. */
    key_levels: {
      opening_range_minutes: openingRangeMinutes,
      hod_lod: linesFor("hod-lod"),
      opening_range: linesFor("opening-range"),
      session_fib: linesFor("fib"),
      prior_day: linesFor("pdh-pdl-pdc"),
      floor_pivots: linesFor("pivots"),
      /** Null when the seed window held only one session — the pivots and PDH/PDL/PDC groups are
       *  then genuinely uncomputable rather than zero. */
      prior_session_ohlc: priorDay,
    },
  };
}

/**
 * OpEx calendar context for a date.
 *
 * `opexDatesInRange`/`isQuarterlyOpex` are the chart's own marks; this adds only the days-until
 * arithmetic, which is date subtraction, not a second opinion about which Friday is OpEx.
 */
export function opexContext(nowMs: number, horizonDays = 120) {
  // ANCHORED TO THE DAY, NOT THE INSTANT. `opexDatesInRange` compares each OpEx against
  // MIDNIGHT UTC of its own date, so passing a mid-session `nowMs` silently drops today's own
  // expiry — asked "when is OpEx" at 14:00 on OpEx day, the honest answer is "today", and the
  // instant-anchored window answered "next month". This shifts the QUERY WINDOW only; which
  // Fridays are OpEx remains entirely the production function's call.
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const dayStartMs = Date.parse(`${today}T00:00:00Z`);
  const dates = opexDatesInRange(dayStartMs, dayStartMs + horizonDays * 86_400_000);
  const rows = dates.map((d) => ({
    date: d,
    quarterly: isQuarterlyOpex(d),
    // Whole calendar days from today, floor — an OpEx "in 0 days" is today's expiry, which is a
    // materially different statement from "in 1 day" and must not round into it.
    days_away: Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
  }));
  const upcoming = rows.filter((r) => r.days_away >= 0);
  return {
    next: upcoming[0] ?? null,
    next_quarterly: upcoming.find((r) => r.quarterly) ?? null,
    upcoming: upcoming.slice(0, 6),
  };
}
