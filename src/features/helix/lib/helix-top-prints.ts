import type { FlowAlert } from "@/lib/api";
import { flowEventTimeMs } from "@/lib/flow-timestamp";
import {
  HELIX_STRIKE_HITS_WINDOW_MS,
  HELIX_TOP_PRINTS_LIMIT,
} from "@/features/helix/lib/helix-strike-leaders";
import { signalWindowAgeMs } from "@/features/helix/lib/helix-signal-detection";

export { HELIX_TOP_PRINTS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";
// Root cause (2026-08-01 Helix audit): this was 5, but the ingest floor (UW_FLOW_MIN_PREMIUM,
// default $200K — see flow-ingest.ts) already guarantees every alert scores at least
// round(200_000 / 1_000_000 * 60) = 12 on the premPts+sweepPts+dtePts scale in
// unusual-whales.ts's score() (max 100) — before any sweep/0DTE bonus. A gate of 5 could never
// filter anything, so "Top Prints" was really "top by premium, +25 if swept, +15 if 0DTE" with
// a conviction-score label that did no filtering. 20 sits strictly above the guaranteed floor:
// a plain (non-swept, non-0DTE) alert must clear ~$333K premium to qualify, while ANY swept or
// 0DTE alert clears 20 even at the floor premium (12+15=27, 12+25=37) — so flagged/high-premium
// activity still surfaces, only unflagged near-floor noise gets filtered. pickByPremium's
// fallback (below) still guarantees the panel never empties out on a quiet tape.
export const HELIX_TOP_PRINTS_MIN_SCORE = 20;

export type TopPrintsMode = "score" | "premium";

function alertsInWindow(
  alerts: readonly FlowAlert[],
  windowMs: number,
  nowMs: number
): FlowAlert[] {
  return alerts.filter((a) => {
    const ms = flowEventTimeMs(a);
    // signalWindowAgeMs rejects a future-dated print rather than letting a negative age slip
    // under `<= windowMs` and read as "in window" — inflates the ranked pool and can falsely
    // clear sessionFallback (which is supposed to mean "no real recent print").
    const age = signalWindowAgeMs(ms, nowMs);
    return age != null && age <= windowMs;
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
