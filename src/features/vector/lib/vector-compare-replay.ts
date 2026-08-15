import {
  clampTimelineIndex,
  formatReplayClock,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  timelineIndexAtOrBeforeTime,
} from "./vector-replay";

/** Match VectorChart replay cadence — one union step advances all linked panes. */
export const LINKED_REPLAY_STEP_MS = 350;

export type VectorLinkedReplayBind = {
  active: boolean;
  cursorTimeSec: number | null;
  /** Bumped on every desk-side scrub/play step so panes re-apply the frame. */
  tick: number;
};

/** Sorted union of per-pane replay timelines — scrubber steps in session time, not pane index. */
export function mergeReplayTimelines(timelines: readonly (readonly number[])[]): number[] {
  const times = new Set<number>();
  for (const tl of timelines) {
    for (const t of tl) times.add(t);
  }
  return [...times].sort((a, b) => a - b);
}

export function linkedReplayClockLabel(timeline: readonly number[], cursorIndex: number): string {
  const t = timeline[cursorIndex];
  return t != null ? formatReplayClock(t) : "—";
}

export {
  clampTimelineIndex,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  timelineIndexAtOrBeforeTime,
};
