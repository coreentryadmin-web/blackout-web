import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import { flowContractKey } from "@/lib/helix/contract-identity";
import { signalWindowAgeMs } from "@/features/helix/lib/helix-signal-detection";

/** HELIX analytics rail — list sizes and strike-hit windows. */

/** Top Prints rail (score / premium leaders). */
export const HELIX_TOP_PRINTS_LIMIT = 12;

/** Strike Stacks / Top Strikes panel. */
export const HELIX_TOP_STRIKES_LIMIT = 12;

/** Net premium ticker leaderboard. */
export const HELIX_NET_PREMIUM_LEADERS_LIMIT = 10;

/** Rolling window for "N hits in last X minutes" copy. */
export const HELIX_STRIKE_HITS_WINDOW_MIN = 15;
export const HELIX_STRIKE_HITS_WINDOW_MS = HELIX_STRIKE_HITS_WINDOW_MIN * 60 * 1000;

export function formatHitsInWindow(hitCount: number, windowMin = HELIX_STRIKE_HITS_WINDOW_MIN): string {
  if (!Number.isFinite(hitCount) || hitCount <= 0) return `No hits in last ${windowMin} min`;
  const noun = hitCount === 1 ? "hit" : "hits";
  return `${hitCount} ${noun} in last ${windowMin} min`;
}

/** Best-effort event time for windowed hit counts — matches LIVE/freshness (real UW time only). */
export function flowStackAlertTimeMs(row: {
  event_at?: string | null;
  alerted_at?: string;
  tape_time_estimated?: boolean;
}): number | null {
  return flowEventTimeMs(row);
}

/** Count prints on the same contract within the rolling window (Top Prints magnitude line). */
export function countMatchingContractHits(
  alerts: readonly FlowAlert[],
  target: Pick<FlowAlert, "ticker" | "strike" | "expiry" | "option_type">,
  windowMs = HELIX_STRIKE_HITS_WINDOW_MS,
  nowMs = Date.now()
): number {
  // Contract identity comes from the shared key, NOT from a per-file comparison. The strike used to
  // be compared at Math.round(...) here, which counted hits on 92.5P toward 93P — two separately
  // traded contracts presented as one stack. See contract-identity.ts.
  const key = flowContractKey(target);
  if (key == null) return 0;
  let n = 0;
  for (const a of alerts) {
    if (flowContractKey(a) !== key) continue;
    const ms = flowStackAlertTimeMs({
      event_at: a.event_at,
      alerted_at: a.alerted_at,
      tape_time_estimated: a.tape_time_estimated,
    });
    // signalWindowAgeMs rejects a future-dated print (age < -tolerance -> null) instead of letting
    // a negative `nowMs - ms` slip under `> windowMs` and count as a fresh hit — the same
    // future-print bug already fixed in detectVelocitySpikes/detectSplitFlow, previously
    // unguarded here.
    const age = signalWindowAgeMs(ms, nowMs);
    if (age == null || age > windowMs) continue;
    n++;
  }
  return n;
}
