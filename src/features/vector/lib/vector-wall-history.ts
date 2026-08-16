import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { VectorTimeframeMinutes } from "./vector-bar-timeframes";
import type { VectorDteHorizon } from "./vector-dte-horizon";

/** Wall overlay lens — GEX from live dealer-gamma ladder; VEX from shared heatmap vanna totals. */
export type VectorWallLens = "gex" | "vex";

export type WallHistorySample = {
  time: number;
  /** GEX (dealer gamma) walls — live via UW WS with heatmap fallback. */
  walls: GexWalls;
  gammaFlip?: number | null;
  /** VEX (dealer vanna) walls — heatmap cache (~8s SPX). Omitted on legacy Redis rows. */
  vexWalls?: GexWalls | null;
  vexFlip?: number | null;
  /**
   * True = this sample was RECONSTRUCTED (modeled from the EOD chain along the observed
   * price path), not OBSERVED by the live recorder. Absent/false = a real recorded sample.
   * Threaded through to the marker layer so modeled beads render dim/ghosted and honestly
   * labeled — a real recorded sample at the same bucket always overwrites it (see
   * mergeModeledUnderlay). Honesty is the whole point: modeled ≠ observed must be visible.
   */
  modeled?: boolean;
};

export function wallsForLens(sample: WallHistorySample, lens: VectorWallLens): GexWalls | null {
  if (lens === "vex") return sample.vexWalls ?? null;
  return sample.walls;
}

export function flipForLens(sample: WallHistorySample, lens: VectorWallLens): number | null {
  const flip = lens === "vex" ? sample.vexFlip : sample.gammaFlip;
  return flip != null && Number.isFinite(flip) && flip > 0 ? flip : null;
}

export function hasVexInHistory(history: WallHistorySample[]): boolean {
  return history.some((s) => Boolean(s.vexWalls?.callWalls?.length || s.vexWalls?.putWalls?.length));
}

export type StrikeTrailPoint = {
  time: number;
  pct: number;
  modeled?: boolean;
  /**
   * Recorded $|gamma| at this strike (`GexWallLevel.notional` from `computeGexWalls`). When present,
   * the bead rail sizes on the honest absolute $ ladder; when absent, frame-relative strength.
   */
  notional?: number;
};

// Sample budget for one ticker's session rail.
//
// This used to read "~one RTH session at 5s trail cadence for oracle tickers (390 min × 12 = 4680)
// plus headroom" — arithmetic that quietly assumed recording STOPS at the close. It does not: the
// universe recorder is not RTH-gated, so an oracle ticker keeps writing every 5s all evening. At
// that cadence 5,760 samples is **8 hours of wall clock**, and the old flat `slice(-MAX_HISTORY)`
// meant every post-close sample evicted an RTH one. Measured live 2026-08-07: SPX's rail ran
// 15:54→23:59 against bars 09:30→16:05 — 2,124 of 2,169 samples sat past the last bar and **97% of
// the trading session had no rail at all**. A member opening SPX in the morning saw no beads for
// the previous day. Non-oracle tickers escaped it only by recording at 15s and never reaching the
// cap, which is exactly why a COUNT cap is the wrong instrument: the same number means "a full day"
// on one lane and "8 hours" on the other.
//
// The budget itself is unchanged — see compactHistoryToCap for what now happens when it is reached.
const MAX_HISTORY = 5760;

/** Newest slice of an over-budget rail kept at full recorder resolution. */
const COMPACT_FULL_RES_SEC = 30 * 60;
/** Bucket width applied to everything older, when the rail is over budget. */
const COMPACT_TAIL_BUCKET_SEC = 15;

/**
 * Bring an over-budget rail back under `cap` by THINNING the old end instead of amputating it.
 *
 * The previous behaviour was `slice(-MAX_HISTORY)` — drop the oldest samples outright. That is
 * what deleted SPX's whole trading session overnight (see MAX_HISTORY above). Here the newest
 * {@link COMPACT_FULL_RES_SEC} stays at full recorder resolution and everything older is bucketed
 * to {@link COMPACT_TAIL_BUCKET_SEC} — the cadence non-oracle tickers already ship all day, so the
 * thinned tail is a resolution production is known to render. Full-day COVERAGE survives; only
 * old-end density is traded away.
 *
 * SPX's real shape: 09:30→23:59 at 5s is 10,440 samples, ~1.8x the budget. After compaction it is
 * 360 (newest 30 min at 5s) + ~3,360 (14h at 15s) = ~3,720 — comfortably under, with the session
 * intact instead of erased.
 *
 * STRICTLY SAFER THAN THE OLD BEHAVIOUR: this runs only when the rail is already over budget, i.e.
 * only where samples were previously being thrown away entirely. Under the cap nothing changes.
 * If one pass is not enough (a pathological burst), it falls back to the old tail slice so the cap
 * is still an absolute bound.
 */
/**
 * Snap a thinned tail sample onto its bucket boundary.
 *
 * Both tail thinners below (compactHistoryToCap, decimateSeedHistory) used to keep the bucket's
 * last reading at its ORIGINAL timestamp. That is invisible for a 15s recorder cadence — the
 * bucket width equals the cadence, so times already sit on 15s boundaries — and fatal for the 5s
 * ORACLE cadence: the last sample in [15k, 15k+15) is at 15k+10, so the whole thinned tail lands
 * on `time % 15 === 10`.
 *
 * That is unrenderable, not merely imprecise. WallRailPrimitive projects each bead with
 * `ts.timeToCoordinate(p.time)`, which lightweight-charts implements as `timeToIndex(time,
 * findNearest = false)` — it returns null for ANY time that is not exactly a bar time, and the
 * primitive then does `if (x == null) continue`. Bar times are multiples of the candle interval
 * (180s on a 3-min chart) and therefore ≡ 0 (mod 15); `15k+10` never is. So every phase-shifted
 * bead was computed and silently discarded at draw time, leaving only the untouched
 * newest-30-minutes window — the right-edge band reported on the SPX desk.
 *
 * Snapping to `bucket` (a multiple of 15, which divides 180) puts the tail back on a grid that CAN
 * coincide with bars. This deliberately overrides the older "kept samples retain their ORIGINAL
 * time — rewriting times would move real beads" invariant: the move is at most one bucket width
 * (≤14s) on a chart whose smallest candle is 60s, and the alternative is not a slightly-misplaced
 * bead but no bead at all.
 *
 * Never moves a sample BACKWARDS past one already kept — `Math.floor` can round below the retained
 * anchor sample when both fall inside the first bucket, and wall history must stay ascending for
 * trailsByStrike's same-bucket coalescing and every downstream slice.
 */
function snapTailSampleToBucket(
  sample: WallHistorySample,
  bucket: number,
  lastKeptTime: number | null
): WallHistorySample {
  if (lastKeptTime != null && bucket <= lastKeptTime) return sample;
  return sample.time === bucket ? sample : { ...sample, time: bucket };
}

export function compactHistoryToCap(
  history: WallHistorySample[],
  cap: number = MAX_HISTORY,
  fullResSec: number = COMPACT_FULL_RES_SEC,
  tailBucketSec: number = COMPACT_TAIL_BUCKET_SEC
): WallHistorySample[] {
  if (history.length <= cap) return history;
  const newest = history[history.length - 1]!.time;
  const liveFrom = newest - fullResSec;

  const out: WallHistorySample[] = [];
  let lastBucket: number | null = null;
  for (let i = 0; i < history.length; i++) {
    const sample = history[i]!;
    // The live window and the very first sample (the session's anchor) are never thinned.
    if (sample.time >= liveFrom || i === 0) {
      out.push(sample);
      lastBucket = null;
      continue;
    }
    const bucket = Math.floor(sample.time / tailBucketSec) * tailBucketSec;
    if (bucket === lastBucket) {
      // Keep the bucket's LAST reading, as the display bucketer does — snapped to the bucket
      // boundary so it stays on a grid the time scale can resolve (see snapTailSampleToBucket).
      out[out.length - 1] = snapTailSampleToBucket(sample, bucket, out.length > 1 ? out[out.length - 2]!.time : null);
      continue;
    }
    lastBucket = bucket;
    out.push(snapTailSampleToBucket(sample, bucket, out.length ? out[out.length - 1]!.time : null));
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** Max simultaneous strike-keyed bead rows per side on the chart (reference shows ~4–6). */
export const MAX_STRIKE_TRAILS_PER_SIDE = 8;

/**
 * How many walls PER SIDE PER BUCKET count as "dominant" and therefore earn a bead that bucket.
 *
 * WHY THIS EXISTS: the recorder stores the full ladder (`VECTOR_WALL_NODES_PER_SIDE` = 20 strikes
 * per side) in every 15s sample. If a trail draws a bead in every bucket where a strike appears
 * ANYWHERE in that 20-deep ladder, then the persistent structural strikes near spot (round numbers
 * that never leave a 20-wide set) get a bead in every bucket → every trail runs full-width from the
 * session open, and a wall that only became dominant intraday is invisible as a "new" wall because
 * it was already sitting in the ladder as a minor member since the open. That is the member report
 * ("SPX had the exact same walls all day — no new walls") and it does NOT match the reference
 * product, where a wall's beads start at the candle it became a real wall and stop/fade when it
 * drops out (Skylit AMD/TSLA/ARM refs: staggered births, gaps, short recent clusters, and only the
 * genuinely persistent levels run full-width).
 *
 * Keeping only each bucket's top-N by |gamma| share restores that: a level that is always among the
 * strongest stays full-width (correctly — it WAS a wall all day), while one that only spikes into
 * the dominant set at 2pm gets a trail born at 2pm. Tracks spot naturally, since gamma concentrates
 * near the money, so walls form where price actually is. Presence windows + gaps are the product,
 * not noise.
 *
 * ── WHY 5, AND WHAT IT COSTS (2026-08-07) ────────────────────────────────────────────────────
 * This was 3 (matching NODES=3 in the Skylit SPY ref, 2026-07-13) after 6 was rolled back on member
 * feedback that TSLA "looked static at top-6". Raised to 5 as a deliberate product call to widen
 * coverage: at 3, a persistently 4th-strongest wall is invisible for an ENTIRE session, which is
 * real structure a member never sees.
 *
 * It is a genuine trade, measured on the 2026-08-07 session by replaying eight tickers' recorded
 * ladders through this exact selection at N=3 vs N=5 (both sides, 16 ticker/side pairs):
 *
 *     rows            109 -> 149   (+37%)   distinct strikes that earn a bead
 *     full-width rows   29 ->  51   (+76%)   present in >=90% of buckets — the "looks static" rows
 *     births            61 ->  69   (+13%)   trails starting inside the window — the formation cue
 *
 * The rows gained skew STATIC: full-width count grows ~6x faster than births, and the static share
 * of the rail goes 27% -> 34%. Per name it split 9 worse / 6 better / 1 unchanged. SPX, SPY, QQQ,
 * META and AMD call-side all improved (SPX call births 1 -> 4). NVDA call (50% -> 71% full-width)
 * and ASTS call (20% -> 57%) got materially more static, and TSLA regressed on BOTH sides
 * (call 14% -> 33%, put 14% -> 40%) — i.e. the same name and the same mechanism behind the original
 * top-6 rollback. If the "static rail" complaint returns, TSLA is where it will show first and this
 * constant is the first thing to put back to 3.
 *
 * NOT env-tunable on purpose: this module is consumed by VectorChart.tsx, a "use client" component,
 * so a server env var is undefined in the browser and a NEXT_PUBLIC_ one is inlined at BUILD time.
 * Either way changing it costs a full rebuild + deploy — exactly what editing this line costs — so
 * the indirection would buy no operational flexibility while hiding the value from this docblock.
 * The durable fix for "members disagree about density" is a chart-level control, not a constant.
 */
export const DOMINANT_WALLS_PER_BUCKET = 5;

/** Live session: only render wall beads within this many seconds of the chart's leading edge. */
export const LIVE_TRAIL_LOOKBACK_SEC = 45 * 60;

/**
 * Holes shorter than this between recorded samples are normal recorder cadence jitter (5–15s).
 * Longer stretches get honest modeled fill via {@link backfillRailGaps}. Was 5 minutes — that
 * left 1–4 minute recorder-drop holes (SWEEP OVER BUDGET) as visible blank bands on every ticker.
 */
export const RAIL_GAP_FILL_MIN_SEC = 60;

/** Fetch a session reconstruction when uncovered rail time exceeds this threshold. */
export const RAIL_RECONSTRUCT_MIN_UNCOVERED_SEC = 5 * 60;

/**
 * Append a wall reading into the session's history, keyed by the trail bucket time (5s for
 * oracle tickers, 15s for others — see vector-wall-sample.ts). Replaces in place when the
 * bucket is unchanged so magnitude updates within the same window don't duplicate beads.
 */
export function recordWallSample(history: WallHistorySample[], sample: WallHistorySample): WallHistorySample[] {
  const last = history[history.length - 1];
  const next = last && last.time === sample.time ? [...history.slice(0, -1), sample] : [...history, sample];
  return compactHistoryToCap(next);
}

/**
 * Project the history down to one side's (call or put) rank-`i` trail as plain
 * {time, strike, pct} points — a bar where that rank didn't exist (e.g. the ladder briefly
 * thinned to fewer distinct strikes) is simply omitted, not filled with a placeholder, so the
 * rendered trail has a genuine gap rather than a misleading flat/zero value.
 */
export function trailForRank(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  rank: number
): Array<{ time: number; strike: number; pct: number }> {
  const points: Array<{ time: number; strike: number; pct: number }> = [];
  for (const sample of history) {
    const level = sample.walls[side][rank];
    if (level) points.push({ time: sample.time, strike: level.strike, pct: level.pct });
  }
  return points;
}

/**
 * Strike-keyed trails — each strike gets its own horizontal bead row (reference product style).
 * When a wall migrates from 7550 → 7575 you see two distinct horizontal trails, not a diagonal
 * scatter from rank-based projection.
 */
export function trailsByStrike(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  lens: VectorWallLens = "gex",
  dominantPerBucket: number = DOMINANT_WALLS_PER_BUCKET
): Map<number, StrikeTrailPoint[]> {
  const map = new Map<number, StrikeTrailPoint[]>();
  for (const sample of history) {
    const walls = wallsForLens(sample, lens);
    if (!walls) continue;
    // Only this bucket's DOMINANT walls earn a bead — see DOMINANT_WALLS_PER_BUCKET. Sorting by
    // |pct| here (the recorded ladder is stored strike-ordered, not strength-ordered) and slicing
    // to top-N is what gives each wall an HONEST birth: a strike enters its trail at the first
    // bucket it ranks among the strongest, not at the open just because it sat in the wide ladder.
    const dominant =
      dominantPerBucket > 0 && walls[side].length > dominantPerBucket
        ? [...walls[side]].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, dominantPerBucket)
        : walls[side];
    for (const level of dominant) {
      const strike = Math.round(level.strike);
      if (!Number.isFinite(strike)) continue;
      let pts = map.get(strike);
      if (!pts) {
        pts = [];
        map.set(strike, pts);
      }
      const last = pts[pts.length - 1];
      // Carry the sample's modeled flag onto the emitted point so the marker layer can
      // render reconstructed beads dim/ghosted vs solid observed ones (same bucket time).
      if (last?.time === sample.time) {
        pts[pts.length - 1] = {
          time: sample.time,
          pct: level.pct,
          modeled: sample.modeled,
          ...(level.notional != null && level.notional > 0 ? { notional: level.notional } : {}),
        };
      } else {
        pts.push({
          time: sample.time,
          pct: level.pct,
          modeled: sample.modeled,
          ...(level.notional != null && level.notional > 0 ? { notional: level.notional } : {}),
        });
      }
    }
  }
  return map;
}

/** A strike's bead row plus its birth/fade lifecycle metadata (see strikeTrailLifecycle). */
export type StrikeTrail = {
  strike: number;
  points: StrikeTrailPoint[];
  /** First bucket this strike appeared as a wall — the wall's BIRTH candle. */
  bornAt: number;
  /** Most recent bucket this strike was a wall. */
  lastSeen: number;
  /** True when the strike is still in the latest bucket THIS SIDE recorded a wall in — i.e. the
   *  wall is currently forming/holding, not one that has dropped out of the set. */
  active: boolean;
};

/**
 * Per-strike lifecycle view of the bead trails. Each strike carries its birth (first observed
 * bucket), last-seen bucket, and whether it is still in the latest bucket this side recorded.
 *
 * This is the birth→fade contract the chart renders against (BUG 3 — "beat Skylit"): a wall's
 * beads START at its birth candle, never back-filled to the session open (inherited directly
 * from {@link trailsByStrike}, which only records a point in the buckets where the strike is
 * actually a wall — a strike that first entered the set at 14:00 has no point before 14:00),
 * and a wall that has left the set is flagged `active:false` so the marker layer can fade/stop
 * it instead of drawing a stale full-width rail. `active` is computed PER SIDE (against the
 * latest bucket where this side had any wall), so calls being briefly absent from the newest
 * bucket doesn't falsely mark every put as dead, and vice-versa.
 */
export function strikeTrailLifecycle(
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  lens: VectorWallLens = "gex"
): StrikeTrail[] {
  const trails = trailsByStrike(history, side, lens);
  // Latest bucket in which THIS side had any wall — the reference point for "still active".
  let latest = Number.NEGATIVE_INFINITY;
  for (const pts of trails.values()) {
    const tail = pts[pts.length - 1]?.time;
    if (tail != null && tail > latest) latest = tail;
  }
  const out: StrikeTrail[] = [];
  for (const [strike, points] of trails) {
    if (!points.length) continue;
    const lastSeen = points[points.length - 1]!.time;
    out.push({
      strike,
      points,
      bornAt: points[0]!.time,
      lastSeen,
      active: lastSeen === latest,
    });
  }
  return out;
}

/**
 * Weight a strike row for the top-N render cap. Blends PEAK strength with mean, so a wall that
 * is strong RIGHT NOW (or peaked hard) keeps its slot instead of being buried by a weaker wall
 * that merely persisted longer.
 *
 * The old pure-cumulative-sum (`Σ pct`) rewarded longevity alone: an 8%-of-gamma wall that only
 * appeared in the last few samples scored a tiny sum and got dropped, while a 3% wall present all
 * session dominated — so the STRONGEST current wall could be missing from the chart entirely
 * (reported live: the 8% put wall had no beads). Peak-biasing surfaces it.
 */
export function strikeTrailWeight(points: StrikeTrailPoint[]): number {
  if (!points.length) return 0;
  let max = 0;
  let sum = 0;
  for (const p of points) {
    if (p.pct > max) max = p.pct;
    sum += p.pct;
  }
  const mean = sum / points.length;
  return max * 0.6 + mean * 0.4;
}

/**
 * How far from spot a strike can sit and still count as "near" for row selection. Expressed as a
 * fraction of spot so it scales across instruments (±2% is 155 SPX points, 12 META points).
 *
 * Chosen to comfortably contain an intraday session's price action plus the walls actually pinning
 * it, while excluding the far-OTM band. Not a hard filter — see pickActiveStrikes.
 */
export const NEAR_SPOT_ROW_BAND_PCT = 0.02;

/**
 * Pick the top-N strike rows to render, preferring strikes NEAR SPOT.
 *
 * Strength alone is the wrong sort key once an instrument's biggest walls live far from price.
 * Index put-wall open interest concentrates in far-OTM crash protection at round strikes, so on
 * SPX the strongest put rows are 3-5% below spot and simply are not on screen — while near-spot
 * walls that a trader is actually leaning on get crowded out of the 8 slots. A single stock does
 * not show this: META's walls sit on top of price, so strength and proximity agree and the old
 * ordering looked correct.
 *
 * Measured on prod 2026-08-07 by replaying this exact ranking over the live rails. SPX spot
 * 7757.64 — put rows came back 8000, 7500, 7600, 7715, 7730, 7705, 7450, 7400: only 3 of 8 within
 * ±1% of spot, the rest 250-350 points away. META spot 592.2 — rows 590, 550, 580, 560, 500, with
 * the leaders sitting right on price. Same code, same cap, opposite outcome.
 *
 * The fix PARTITIONS rather than filters: near-spot rows are ranked by strength and fill the slots
 * first, then any remaining slots are backfilled with the strongest out-of-band rows. A genuine
 * far-OTM wall is therefore still drawn when there is room for it — this never silently drops a
 * wall that would previously have rendered UNLESS a nearer, on-screen wall wanted the slot. With
 * `spot` absent (null/0/NaN — the caller cannot always resolve it) behaviour is byte-identical to
 * the previous pure-strength ordering.
 */
export function pickActiveStrikes(
  trails: Map<number, StrikeTrailPoint[]>,
  maxStrikes: number = MAX_STRIKE_TRAILS_PER_SIDE,
  opts: { spot?: number | null; bandPct?: number } = {}
): number[] {
  const byStrength = [...trails.entries()].sort(
    (a, b) => strikeTrailWeight(b[1]) - strikeTrailWeight(a[1])
  );

  const spot = opts.spot;
  // No usable spot → keep the historical ordering exactly. Guarding on `> 0` also covers NaN.
  if (!(typeof spot === "number" && Number.isFinite(spot) && spot > 0)) {
    return byStrength.slice(0, maxStrikes).map(([strike]) => strike);
  }

  const band = opts.bandPct ?? NEAR_SPOT_ROW_BAND_PCT;
  const near: typeof byStrength = [];
  const far: typeof byStrength = [];
  for (const entry of byStrength) {
    (Math.abs(entry[0] - spot) / spot <= band ? near : far).push(entry);
  }

  // Both halves are already strength-ordered (they were partitioned out of a sorted list), so
  // concatenating preserves strength ranking WITHIN each half while promoting the near half.
  return [...near, ...far].slice(0, maxStrikes).map(([strike]) => strike);
}

/** Anchor live trail trimming to the latest candle or wall sample — not wall-clock alone. */
export function liveTrailAnchorSec(
  history: WallHistorySample[],
  barTimes: number[] = []
): number {
  const historyTail = history[history.length - 1]?.time ?? 0;
  const barTail = barTimes.length ? barTimes[barTimes.length - 1]! : 0;
  return Math.max(historyTail, barTail) || Math.floor(Date.now() / 1000);
}

/**
 * Drop wall-history samples older than the live lookback window so migrated strikes do not
 * leave stale horizontal bead rows across the chart all session.
 */
export function trimHistoryForLiveTrails(
  history: WallHistorySample[],
  lookbackSec: number = LIVE_TRAIL_LOOKBACK_SEC,
  anchorSec?: number
): WallHistorySample[] {
  if (!history.length) return history;
  const anchor = anchorSec ?? history[history.length - 1]!.time;
  const cutoff = anchor - lookbackSec;
  return history.filter((s) => s.time >= cutoff);
}

export type BucketWallHistoryOpts = {
  /** Floor bucket size for live display — e.g. 5 keeps 5s bead density on 1m charts. */
  minBucketSec?: number;
  /** When true, use minBucketSec instead of collapsing to candle width. */
  liveBeads?: boolean;
};

/**
 * Snap wall-history sample times onto the chart's visible bar grid so lightweight-charts
 * `timeToCoordinate` resolves (exact bar time required — see vector-bead-bucket-grid.test.ts).
 * Each sample maps to the latest bar time ≤ its bucket; duplicates coalesce last-wins.
 */
export function alignWallHistoryToBarTimes(
  history: WallHistorySample[],
  barTimes: readonly number[]
): WallHistorySample[] {
  if (!history.length || !barTimes.length) return history;
  const sorted = [...barTimes].sort((a, b) => a - b);
  const map = new Map<number, WallHistorySample>();
  for (const sample of history) {
    let snap = sorted[0]!;
    for (const t of sorted) {
      if (t <= sample.time) snap = t;
      else break;
    }
    map.set(snap, { ...sample, time: snap });
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s);
}

/**
 * Resample wall-history for chart beads. Live mode keeps the trail sample cadence (5s);
 * replay / higher-TF views collapse to candle buckets.
 */
export function bucketWallHistoryForInterval(
  history: WallHistorySample[],
  intervalMinutes: VectorTimeframeMinutes,
  opts?: BucketWallHistoryOpts
): WallHistorySample[] {
  if (!history.length) return history;
  const candleSec = intervalMinutes * 60;
  const bucketSec =
    opts?.liveBeads && opts.minBucketSec != null && opts.minBucketSec > 0
      ? Math.min(candleSec, opts.minBucketSec)
      : candleSec;
  const map = new Map<number, WallHistorySample>();

  for (const sample of history) {
    const key = Math.floor(sample.time / bucketSec) * bucketSec;
    map.set(key, { ...sample, time: key });
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, sample]) => sample);
}

/**
 * When no per-bar history exists yet (fresh deploy / first page load off-hours), seed ONE
 * honest sample at the last visible candle bar with the current wall ladder — dots land at
 * session close on the right edge of the chart instead of a trail-less void. Does not invent
 * historical points across earlier bars (no GEX time-series source for backfill).
 */
export function seedWallHistoryForDisplay(
  history: WallHistorySample[],
  barTimes: number[],
  walls: GexWalls | null | undefined,
  gammaFlip?: number | null,
  vexWalls?: GexWalls | null,
  vexFlip?: number | null
): WallHistorySample[] {
  if (history.length > 0 || barTimes.length === 0) return history;
  const hasGex = Boolean(walls?.callWalls?.length || walls?.putWalls?.length);
  const hasVex = Boolean(vexWalls?.callWalls?.length || vexWalls?.putWalls?.length);
  if (!hasGex && !hasVex) return history;
  const lastTime = barTimes[barTimes.length - 1]!;
  if (!Number.isFinite(lastTime)) return history;
  return recordWallSample([], {
    time: lastTime,
    walls: walls ?? { callWalls: [], putWalls: [] },
    gammaFlip: gammaFlip ?? null,
    vexWalls: hasVex ? vexWalls : null,
    vexFlip: vexFlip ?? null,
  });
}

/**
 * Bead-trail source for a NARROWED DTE horizon (0DTE/weekly/monthly), or null to signal "use the
 * blended recorded rail instead". The recorded session rail is blended near-term only — there is no
 * per-horizon point-in-time history — so under a narrowed toggle we draw the CURRENT horizon-scoped
 * walls as a single point-in-time column at the latest bar (honest "current 0DTE/weekly/monthly
 * structure"), genuinely distinct from "All". Returns null for the "all" horizon, the VEX lens
 * (no horizon scope), an empty/absent scoped wall set, or a missing bar time — in every such case
 * the caller falls back to the blended rail, so beads never blank on a toggle.
 */
export function narrowedHorizonTrail(
  horizon: VectorDteHorizon,
  lens: VectorWallLens,
  scoped: GexWalls | null | undefined,
  lastBarTime: number,
  flip: number | null | undefined
): WallHistorySample[] | null {
  const hasNodes = Boolean(scoped && (scoped.callWalls.length > 0 || scoped.putWalls.length > 0));
  if (horizon === "all" || lens !== "gex" || !hasNodes || !(lastBarTime > 0)) return null;
  return [{ time: lastBarTime, walls: scoped!, gammaFlip: flip ?? null }];
}

/**
 * Compose the bead trail to draw for a NARROWED DTE horizon from its two sources:
 *   - `recorded`: the durable per-horizon trail (composite-keyed rail, PR #186) — the FROZEN
 *     point-in-time clusters that make weekly/monthly show accumulated beads after close, the
 *     after-hours analogue of the blended "All" rail. Pass null/empty for "all" / the VEX lens /
 *     nothing recorded (the caller owns that gate).
 *   - `current`: {@link narrowedHorizonTrail}'s single current-structure column at the latest bar.
 *
 * Precedence: prefer the recorded trail, but UNION the current column into it (mergeWallHistory,
 * by bucket time) so the newest live structure paints even before the 5-min recorder writes the
 * current bucket — the current column overwrites/extends the recorded tail, never regresses it.
 * With no recorded trail, fall back to the current column alone. With neither, return null so the
 * caller draws the blended "All" rail (beads never blank on a toggle).
 */
export function composeHorizonTrail(
  recorded: WallHistorySample[] | null | undefined,
  current: WallHistorySample[] | null | undefined
): WallHistorySample[] | null {
  if (recorded && recorded.length > 0) {
    return current && current.length > 0 ? mergeWallHistory(recorded, current) : recorded;
  }
  return current && current.length > 0 ? current : null;
}

/**
 * Choose the wall-history rail to REPLAY for a DTE horizon: the recorded per-horizon trail
 * (frozen point-in-time samples, PR #186) when a narrowed GEX horizon has one, else the blended
 * "All" rail the caller passes. This makes replay reconstruct how the SELECTED horizon's clusters
 * built through the session, not always the "All" rail.
 *
 * Unlike {@link composeHorizonTrail} there is deliberately NO current-column union: replay slices
 * this to the cursor and must never surface structure newer than the cursor (the recorded trail is
 * already point-in-time; the live "current" column is future data relative to a past cursor). "all"
 * and the VEX lens (no per-horizon recording) always replay the blended rail.
 */
export function pickReplayTrailSource(
  horizon: VectorDteHorizon,
  lens: VectorWallLens,
  recorded: WallHistorySample[] | null | undefined,
  blended: WallHistorySample[]
): WallHistorySample[] {
  if (horizon !== "all" && lens === "gex" && recorded && recorded.length > 0) return recorded;
  return blended;
}

/** Merge server-observed history into the client buffer — union by bar time, longer tail wins ties. */
export function mergeWallHistory(
  local: WallHistorySample[],
  remote: WallHistorySample[] | null | undefined
): WallHistorySample[] {
  if (!remote?.length) return local;
  if (!local.length) return remote;
  const byTime = new Map<number, WallHistorySample>();
  for (const sample of local) byTime.set(sample.time, sample);
  for (const sample of remote) byTime.set(sample.time, sample);
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return compactHistoryToCap(merged);
}

/**
 * Compose the instant "modeled underlay" trail with the real recorded rail, keyed by bucket
 * time. Modeled (reconstructed) samples fill the whole session immediately; wherever the live
 * recorder actually OBSERVED a sample, that observed row OVERWRITES the modeled one at the same
 * bucket. Result: a member sees the full-day wall trail on load (dim modeled beads), which solid
 * observed beads replace as/where they exist — honestly labeled modeled vs observed, never the
 * earlier #160 bug where reconstruction was presented AS observed with no distinction.
 *
 * Precedence: insert every modeled sample first (tagged modeled:true), THEN every observed sample
 * (tagged modeled:false) — a later Map.set at the same key wins, so observed always takes its
 * bucket. Empty observed → all-modeled; empty modeled → all-observed. Never throws. Respects the
 * same MAX_HISTORY tail cap as mergeWallHistory.
 */
/**
 * UNIVERSE PARITY (any-ticker rail): fill the PRE-VIEW gap of a session with the honest
 * reconstruction, without ever touching observed samples.
 *
 * A ticker outside the pre-recorded universe has no rail before its first viewer connects — the
 * live hub records from first view onward, so a member opening (say) PLTR at 2pm sees a rail that
 * starts at 2pm. This helper backfills ONLY the missing PREFIX (buckets strictly BEFORE the first
 * observed sample) from the reconstruction rail (fixed published OI, gamma recomputed along the
 * session's real spot path — genuinely time-varying, labeled modeled → ghost beads). Observed
 * samples stay solid and untouched; the model never overwrites or extends past them, so a member
 * can always tell recorded structure from reconstructed context.
 *
 * No-ops (returns `observed` as-is) when the observed rail already starts near the session open
 * (prefix gap ≤ minPrefixGapSec) or the model has nothing before the first observed bucket.
 */
export function backfillRailPrefix(
  observed: WallHistorySample[],
  modeled: WallHistorySample[],
  firstBarTime: number | undefined,
  minPrefixGapSec: number = 20 * 60
): WallHistorySample[] {
  if (!modeled?.length || firstBarTime == null || !Number.isFinite(firstBarTime)) return observed;
  const firstObserved = observed[0]?.time ?? Number.POSITIVE_INFINITY;
  if (firstObserved - firstBarTime <= minPrefixGapSec) return observed;
  const prefix = modeled.filter((s) => s.time < firstObserved);
  if (!prefix.length) return observed;
  return mergeModeledUnderlay(observed, prefix);
}

/**
 * Every stretch of the session the observed rail does NOT cover, as [from,to) second ranges.
 *
 * "Covered" means an observed sample sits within `minGapSec` — the recorder writes on a cadence, so
 * a bucket is legitimately represented by the sample just before it. Pure; used both to decide
 * whether a reconstruction is worth fetching and (via {@link backfillRailGaps}) to fill it.
 */
export function railCoverageGaps(
  observed: WallHistorySample[],
  firstBarTime: number | undefined,
  lastBarTime: number | undefined,
  minGapSec: number = 5 * 60
): Array<{ from: number; to: number }> {
  if (firstBarTime == null || lastBarTime == null) return [];
  if (!Number.isFinite(firstBarTime) || !Number.isFinite(lastBarTime)) return [];
  if (lastBarTime <= firstBarTime) return [];
  const times = observed.map((s) => s.time).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const gaps: Array<{ from: number; to: number }> = [];
  let cursor = firstBarTime;
  for (const t of times) {
    // Clamp to the last bar. The recorder keeps writing after the close (AMD's rail runs to 23:40
    // against a 19:59 last bar), so an unclamped gap would stretch to a sample the chart has no
    // candle for — asking the reconstruction to fill hours that can never render.
    const end = Math.min(t, lastBarTime);
    if (end - cursor > minGapSec) gaps.push({ from: cursor, to: end });
    if (t > cursor) cursor = t;
    if (cursor >= lastBarTime) return gaps;
  }
  if (lastBarTime - cursor > minGapSec) gaps.push({ from: cursor, to: lastBarTime });
  return gaps;
}

/** Total seconds of the session the observed rail leaves uncovered. */
export function railUncoveredSec(
  observed: WallHistorySample[],
  firstBarTime: number | undefined,
  lastBarTime: number | undefined,
  minGapSec: number = 5 * 60
): number {
  let total = 0;
  for (const g of railCoverageGaps(observed, firstBarTime, lastBarTime, minGapSec)) total += g.to - g.from;
  return total;
}

/**
 * FULL-DAY RAIL (FINDINGS 2026-08-07): fill EVERY gap in the session with the honest
 * reconstruction — not only the pre-view prefix.
 *
 * {@link backfillRailPrefix} filled the leading gap only, which was the right fix for the case it
 * was written for ("member opens PLTR at 2pm and the rail starts at 2pm"). But for any ticker
 * outside the shared universe the recorder is VIEWER-DRIVEN — `recordActiveNonUniverseWallSamples`
 * samples only `getActiveVectorTickers()` — so the rail has a hole wherever nobody had the chart
 * open, not just at the front. Live evidence (AMD, 2026-08-06): dense beads 09:30-16:00 while
 * members watched, a 30-minute hole at 14:45-15:15 when the last viewer left, and NOTHING from
 * 16:00 to the 19:59 last bar — a three-hour blank block on a chart still printing candles.
 *
 * A modeled sample is kept only where the observed rail leaves a real gap, so observed structure is
 * never displaced and never extended. Modeled beads carry `modeled: true` and render dim/ghosted,
 * so a member can always tell recorded structure from reconstructed context.
 */
export function backfillRailGaps(
  observed: WallHistorySample[],
  modeled: WallHistorySample[],
  firstBarTime: number | undefined,
  lastBarTime: number | undefined,
  minGapSec: number = 5 * 60
): WallHistorySample[] {
  if (!modeled?.length) return observed;
  const gaps = railCoverageGaps(observed, firstBarTime, lastBarTime, minGapSec);
  if (!gaps.length) return observed;
  const inGap = (t: number) => gaps.some((g) => t >= g.from && t <= g.to);
  const fill = modeled.filter((s) => Number.isFinite(s.time) && inGap(s.time));
  if (!fill.length) return observed;
  return mergeModeledUnderlay(observed, fill);
}

/**
 * Drop wall-history samples that predate the CURRENT session's first bar before an SSR seed ships
 * to the client. `combined`/`mergeWallHistory` retain up to MAX_HISTORY (~one RTH session at the oracle
 * 5s cadence; see the constant) for recorder resilience across restarts/replays, but a single-session Vector page (one
 * `sessionYmd`, one visible bar range) never renders a prior session's beads — every consumer
 * (`trailsByStrike`, `trailForFlipLevel`) only ever sees `barTimes` for the CURRENT session. Prior
 * sessions' full 20-strike-per-side ladders were riding along in the SSR payload as pure dead
 * weight (measured: 28-50MB HTML, 10-12s to download on `/vector` and the SPX Slayer embed).
 * `firstBarTime` is the current session's first bar — `backfillRailPrefix`'s modeled prefix always
 * sits at `time >= firstBarTime`, so this never clips the intentional gap-fill.
 */
export function trimHistoryToSession(
  history: WallHistorySample[],
  firstBarTime: number | undefined
): WallHistorySample[] {
  if (firstBarTime == null || !Number.isFinite(firstBarTime) || history.length === 0) return history;
  const firstIdx = history.findIndex((s) => s.time >= firstBarTime);
  if (firstIdx <= 0) return history;
  return history.slice(firstIdx);
}

/** Trim + decimate a persisted rail for fast embed/bootstrap transport (same rules as SSR seed). */
export function prepareRailBootstrapHistory(
  history: WallHistorySample[],
  firstBarTime?: number
): WallHistorySample[] {
  return decimateSeedHistory(trimHistoryToSession(history, firstBarTime));
}

/**
 * How much of the trail's NEWEST end an SSR seed ships at full recorder resolution.
 *
 * "What is happening right now" is the part a member reads bead-by-bead, so it stays untouched.
 */
export const SEED_FULL_RESOLUTION_SEC = 30 * 60;

/**
 * Bucket width applied to everything OLDER than {@link SEED_FULL_RESOLUTION_SEC}.
 *
 * WAS 15s, matched to `VECTOR_BEAD_RECORD_ACTIVE_TICK_MS` — the cadence the recorder already uses
 * for non-oracle tickers, so the decimated tail was exactly the trail a non-oracle ticker ships.
 * Sound reasoning, but it anchored on what the RECORDER produces rather than on what the seed
 * costs, and the tail is not one RTH session long: the recorder is not RTH-gated, so it spans
 * ~10 hours of wall clock (see the MAX_HISTORY note above). 10h at 15s is ~2,400 tail samples per
 * rail, each carrying a full 20-per-side ladder — and /vector ships TWO rails for an oracle ticker.
 *
 * Measured live 2026-08-09, `/vector?ticker=SPX`: a 10.44 MB generated document (0.50 MB on the
 * wire after zstd — the wire was never the problem) against 40-170 KB for every other desk page.
 * TTFB was healthy at 143-353 ms across all of them, so the cost is not upstream latency: it is
 * generating, serialising and compressing ~5,400 samples per request on a `force-dynamic`,
 * `no-store` route — paid by every member on every load.
 *
 * 60s buckets cut the tail ~4x. The trail's older end is CONTEXT, read as shape rather than
 * bead-by-bead: ~600 columns over a 10h tail is still finer than the pixels that region of the
 * chart gets. The newest {@link SEED_FULL_RESOLUTION_SEC} — the part actually read bead-by-bead —
 * is untouched at full recorder fidelity, and the live SSE/poll path still appends at full cadence,
 * so a member watching the session sees exactly what they see today.
 *
 * MEASURED AFTER DEPLOY (2026-08-09), because the estimate was wrong and the real number belongs
 * here rather than the guess: the generated document fell 10.44 -> 3.82 MB on SPX, 3.94 -> 1.67 QQQ,
 * 2.92 -> 1.29 NVDA, 2.15 -> 1.02 AAPL. That is **~2.1-2.7x overall**, not the ~7x the shipping PR
 * (#1960) claimed in its title.
 *
 * Why the estimate missed: it treated the payload as tail-dominated, so a 4x cut to the tail looked
 * like a ~7x cut to the whole. In a real rail the untouched newest-30-minutes window plus the fixed
 * per-page overhead are a much larger share than that model assumed. Note the unit test asserting
 * ">5x reduction" still passes — it feeds a synthetic 8.4h rail at a flat 5s cadence, which IS
 * tail-dominated. The test validates the FUNCTION; it was never evidence about production, and
 * reading it as such is how the 7x claim survived to the PR title.
 */
export const SEED_TAIL_BUCKET_SEC = 60;

/**
 * Decimate the OLD end of a session's wall history before it is serialised into SSR HTML.
 *
 * WHY (FINDINGS 2026-08-07): `trimHistoryToSession` cut the seed to one session, which was the
 * right fix for the prior-session dead weight it was written for — but one session at the oracle
 * recorder's 5s cadence is still 5,760 samples, and each sample carries a full 20-per-side wall
 * ladder (~2.5 KB). Measured live on `/vector?ticker=SPX`: `initialWallHistory` 14.76 MB +
 * `initialHorizonWallHistory` 7.82 MB = **22.6 MB of a 22.8 MB HTML document** (`initialBars`, the
 * actual price data, is 143 KB). Every member paid that on every load.
 *
 * The seed is over-resolved, not merely large. 5,760 bead columns on a chart that is ~1,600 CSS px
 * wide is ~3.6 columns per pixel — the renderer physically cannot show them apart. So the tail is
 * bucketed to a width the chart can actually resolve while the live end keeps full fidelity.
 *
 * Invariants, all pinned by tests:
 *  - the newest {@link SEED_FULL_RESOLUTION_SEC} is returned untouched — sample-for-sample;
 *  - the FIRST sample always survives, so the session-open bead and `backfillRailPrefix`'s modeled
 *    prefix boundary can never be decimated away;
 *  - kept samples in the DECIMATED TAIL are snapped to their bucket start; samples in the
 *    untouched newest window keep their original `time`. The old invariant ("never re-keyed")
 *    made the 5s oracle tail land on `t % 15 === 10`, which the time scale cannot resolve to a
 *    bar and the rail primitive therefore dropped entirely — see snapTailSampleToBucket;
 *  - order is preserved and the output is a subset of the input, so `modeled` flags, dominance
 *    filtering and `trailsByStrike`'s "still in the latest bucket" logic all keep working on real
 *    recorded samples rather than synthesised ones.
 *
 * This trims the SEED only. The live SSE/poll path keeps appending at the recorder's full cadence,
 * so a member watching the session sees exactly what they see today.
 */
export function decimateSeedHistory(
  history: WallHistorySample[],
  opts?: { fullResolutionSec?: number; tailBucketSec?: number }
): WallHistorySample[] {
  const fullSec = opts?.fullResolutionSec ?? SEED_FULL_RESOLUTION_SEC;
  const bucketSec = opts?.tailBucketSec ?? SEED_TAIL_BUCKET_SEC;
  if (history.length < 2 || !(bucketSec > 0) || !(fullSec >= 0)) return history;

  const newest = history[history.length - 1]!.time;
  const liveFrom = newest - fullSec;

  const out: WallHistorySample[] = [];
  let lastBucket: number | null = null;
  for (let i = 0; i < history.length; i++) {
    const sample = history[i]!;
    // Live window and the very first sample are never decimated.
    if (sample.time >= liveFrom || i === 0) {
      out.push(sample);
      lastBucket = null; // leaving the tail — reset so a later out-of-order sample can't be eaten
      continue;
    }
    const bucket = Math.floor(sample.time / bucketSec) * bucketSec;
    if (bucket === lastBucket) {
      // Same bucket as the sample already kept: replace it, so the bucket keeps its LAST reading —
      // the same "last wins" rule bucketWallHistoryForInterval uses for display. Snapped to the
      // bucket boundary so the thinned tail stays renderable (see snapTailSampleToBucket).
      out[out.length - 1] = snapTailSampleToBucket(sample, bucket, out.length > 1 ? out[out.length - 2]!.time : null);
      continue;
    }
    lastBucket = bucket;
    out.push(snapTailSampleToBucket(sample, bucket, out.length ? out[out.length - 1]!.time : null));
  }
  return out;
}

export function mergeModeledUnderlay(
  observed: WallHistorySample[],
  modeled: WallHistorySample[]
): WallHistorySample[] {
  const byTime = new Map<number, WallHistorySample>();
  for (const sample of modeled ?? []) byTime.set(sample.time, { ...sample, modeled: true });
  // Observed inserted second → overwrites the modeled entry sharing its bucket time.
  for (const sample of observed ?? []) byTime.set(sample.time, { ...sample, modeled: false });
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return compactHistoryToCap(merged);
}

/** Flip bead trail for the active lens (gamma flip or zero-vanna flip). */
export function trailForFlipLevel(
  history: WallHistorySample[],
  lens: VectorWallLens = "gex"
): Array<{ time: number; strike: number }> {
  const points: Array<{ time: number; strike: number }> = [];
  for (const sample of history) {
    const flip = flipForLens(sample, lens);
    if (flip != null) points.push({ time: sample.time, strike: Math.round(flip) });
  }
  return points;
}

/** @deprecated Use trailForFlipLevel(history, "gex") */
export function trailForGammaFlip(history: WallHistorySample[]): Array<{ time: number; strike: number }> {
  return trailForFlipLevel(history, "gex");
}
