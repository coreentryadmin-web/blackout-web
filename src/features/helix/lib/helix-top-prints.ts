import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import {
  HELIX_STRIKE_HITS_WINDOW_MS,
  HELIX_TOP_PRINTS_LIMIT,
} from "@/features/helix/lib/helix-strike-leaders";

export { HELIX_TOP_PRINTS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";
export const HELIX_TOP_PRINTS_MIN_SCORE = 5;

export type TopPrintsMode = "score" | "premium";

function alertsInWindow(
  alerts: readonly FlowAlert[],
  windowMs: number,
  nowMs: number
): FlowAlert[] {
  return alerts.filter((a) => {
    const ms = flowEventTimeMs(a);
    return ms != null && nowMs - ms <= windowMs;
  });
}

function pickByScore(alerts: readonly FlowAlert[]): FlowAlert[] {
  return [...alerts]
    .filter((a) => a.score >= HELIX_TOP_PRINTS_MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.premium - a.premium)
    .slice(0, HELIX_TOP_PRINTS_LIMIT);
}

function pickByPremium(alerts: readonly FlowAlert[]): FlowAlert[] {
  return [...alerts]
    .sort((a, b) => b.premium - a.premium)
    .slice(0, HELIX_TOP_PRINTS_LIMIT);
}

/**
 * Top conviction rows for the analytics rail — score-first, premium fallback.
 * Prefers prints inside the rolling hit window so "N hits in last 15 min" is meaningful;
 * falls back to session leaders when the tape is quiet in-window.
 */
export function selectTopPrints(
  alerts: readonly FlowAlert[],
  opts?: { nowMs?: number; windowMs?: number }
): {
  rows: FlowAlert[];
  mode: TopPrintsMode;
  /** True when every row is outside the rolling hit window (stale session leaders). */
  sessionFallback: boolean;
} {
  if (!alerts.length) return { rows: [], mode: "score", sessionFallback: false };

  const nowMs = opts?.nowMs ?? Date.now();
  const windowMs = opts?.windowMs ?? HELIX_STRIKE_HITS_WINDOW_MS;
  const recent = alertsInWindow(alerts, windowMs, nowMs);
  const pool = recent.length > 0 ? recent : alerts;
  const sessionFallback = recent.length === 0;

  const byScore = pickByScore(pool);
  if (byScore.length > 0) return { rows: byScore, mode: "score", sessionFallback };

  const byPremium = pickByPremium(pool);
  return { rows: byPremium, mode: "premium", sessionFallback };
}
