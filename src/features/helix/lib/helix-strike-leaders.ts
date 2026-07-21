import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import { normalizeFlowExpiry } from "@/lib/largo/flow-strike-stacks";

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

function normalizeExpiryKey(expiry: string): string {
  return normalizeFlowExpiry(expiry);
}

/** Count prints on the same contract within the rolling window (Top Prints magnitude line). */
export function countMatchingContractHits(
  alerts: readonly FlowAlert[],
  target: Pick<FlowAlert, "ticker" | "strike" | "expiry" | "option_type">,
  windowMs = HELIX_STRIKE_HITS_WINDOW_MS,
  nowMs = Date.now()
): number {
  const ticker = target.ticker.toUpperCase();
  const opt = target.option_type.toUpperCase();
  const exp = normalizeExpiryKey(target.expiry);
  let n = 0;
  for (const a of alerts) {
    if (a.ticker.toUpperCase() !== ticker) continue;
    if (a.option_type.toUpperCase() !== opt) continue;
    if (Math.round(a.strike) !== Math.round(target.strike)) continue;
    if (normalizeExpiryKey(a.expiry) !== exp) continue;
    const ms = flowStackAlertTimeMs({
      event_at: a.event_at,
      alerted_at: a.alerted_at,
      tape_time_estimated: a.tape_time_estimated,
    });
    if (ms == null || nowMs - ms > windowMs) continue;
    n++;
  }
  return n;
}
