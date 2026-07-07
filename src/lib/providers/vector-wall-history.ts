import type { GexWalls } from "@/lib/providers/gex-wall-levels";

export type WallHistorySample = { time: number; walls: GexWalls };

// ~one RTH session of 1-minute bars — mirrors spx-candle-store.ts's ring-buffer sizing, so the
// trail can span a full session without growing unbounded across a long-running connection.
const MAX_HISTORY = 390;

/**
 * Append a wall reading into the session's history, keyed by the CANDLE's own bar time (not
 * wall-clock) so the client's historical dot-trail lines up exactly under the corresponding
 * candles. If the latest entry is for the SAME bar (still forming — the wall recomputes on
 * every ~1s tick, far more often than the once-a-minute bar rollover), replace it in place
 * rather than appending a duplicate, so one bar always maps to exactly one history entry.
 * Trimmed to MAX_HISTORY from the front so a long-running connection doesn't grow unbounded.
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
