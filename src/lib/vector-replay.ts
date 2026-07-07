import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "@/lib/providers/vector-wall-history";

export type VectorReplayBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Sorted union of wall-sample times and candle bar times — replay scrubber steps. */
export function buildReplayTimeline(
  history: WallHistorySample[],
  bars: VectorReplayBar[]
): number[] {
  const times = new Set<number>();
  for (const sample of history) times.add(sample.time);
  for (const bar of bars) times.add(bar.time);
  return [...times].sort((a, b) => a - b);
}

export function sliceHistoryToTime(
  history: WallHistorySample[],
  cursorTime: number
): WallHistorySample[] {
  return history.filter((s) => s.time <= cursorTime);
}

export function sliceBarsToTime(bars: VectorReplayBar[], cursorTime: number): VectorReplayBar[] {
  return bars.filter((b) => b.time <= cursorTime);
}

/** Latest wall ladder at or before the replay cursor. */
export function wallsAtReplayTime(
  history: WallHistorySample[],
  cursorTime: number
): GexWalls | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const sample = history[i];
    if (sample.time <= cursorTime) return sample.walls;
  }
  return null;
}

/** Format a unix-second timestamp for the replay scrubber (ET). */
export function formatReplayClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
