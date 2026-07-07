import type { GexWalls } from "@/lib/providers/gex-wall-levels";

export type WallHistorySample = { time: number; walls: GexWalls; gammaFlip?: number | null };

export type StrikeTrailPoint = { time: number; pct: number };

// ~one RTH session at 15s trail cadence (390 min × 4 ≈ 1560) plus headroom.
const MAX_HISTORY = 1920;

/** Max simultaneous strike-keyed bead rows per side on the chart (reference shows ~4–6). */
export const MAX_STRIKE_TRAILS_PER_SIDE = 8;

/**
 * Append a wall reading into the session's history, keyed by the trail bucket time (15s by
 * default — see vector-wall-sample.ts). Replaces in place when the bucket is unchanged so
 * magnitude updates within the same 15s window don't duplicate beads.
 */
export function recordWallSample(history: WallHistorySample[], sample: WallHistorySample): WallHistorySample[] {
  const last = history[history.length - 1];
  const next = last && last.time === sample.time ? [...history.slice(0, -1), sample] : [...history, sample];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
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
  side: "callWalls" | "putWalls"
): Map<number, StrikeTrailPoint[]> {
  const map = new Map<number, StrikeTrailPoint[]>();
  for (const sample of history) {
    for (const level of sample.walls[side]) {
      const strike = Math.round(level.strike);
      if (!Number.isFinite(strike)) continue;
      let pts = map.get(strike);
      if (!pts) {
        pts = [];
        map.set(strike, pts);
      }
      const last = pts[pts.length - 1];
      if (last?.time === sample.time) {
        pts[pts.length - 1] = { time: sample.time, pct: level.pct };
      } else {
        pts.push({ time: sample.time, pct: level.pct });
      }
    }
  }
  return map;
}

/** Weight a strike row by cumulative magnitude so dominant walls stay visible when capping. */
export function strikeTrailWeight(points: StrikeTrailPoint[]): number {
  return points.reduce((sum, p) => sum + p.pct, 0);
}

/** Pick the top-N strike rows to render (by cumulative |gamma| share across the session). */
export function pickActiveStrikes(
  trails: Map<number, StrikeTrailPoint[]>,
  maxStrikes: number = MAX_STRIKE_TRAILS_PER_SIDE
): number[] {
  return [...trails.entries()]
    .sort((a, b) => strikeTrailWeight(b[1]) - strikeTrailWeight(a[1]))
    .slice(0, maxStrikes)
    .map(([strike]) => strike);
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
  gammaFlip?: number | null
): WallHistorySample[] {
  if (history.length > 0 || !walls || barTimes.length === 0) return history;
  const lastTime = barTimes[barTimes.length - 1]!;
  if (!Number.isFinite(lastTime)) return history;
  return recordWallSample([], { time: lastTime, walls, gammaFlip: gammaFlip ?? null });
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
  return merged.length > MAX_HISTORY ? merged.slice(merged.length - MAX_HISTORY) : merged;
}

/** Gamma-flip bead trail — horizontal row at the flip strike when present. */
export function trailForGammaFlip(
  history: WallHistorySample[]
): Array<{ time: number; strike: number }> {
  const points: Array<{ time: number; strike: number }> = [];
  for (const sample of history) {
    const flip = sample.gammaFlip;
    if (flip != null && Number.isFinite(flip) && flip > 0) {
      points.push({ time: sample.time, strike: Math.round(flip) });
    }
  }
  return points;
}
