/**
 * Discovery event log — append-only lifecycle events for 0DTE candidates (Phase 1 event sourcing).
 *
 * Events are keyed by (session_date, ticker) and replayable for calibration + UI timeline.
 * Persist is best-effort; scan never blocks on a write failure.
 */

export type DiscoveryEventKind =
  | "detected"
  | "score_changed"
  | "flow_increased"
  | "gate_blocked"
  | "commit"
  | "trim"
  | "stop"
  | "closed";

export type DiscoveryEventPayload = {
  kind: DiscoveryEventKind;
  session_date: string;
  ticker: string;
  /** Discovery rails at event time (FLOW/BREAKOUT/PIN). */
  origins?: string[];
  score?: number | null;
  weighted_score?: number | null;
  gate_code?: string | null;
  detail?: string | null;
  at_ms: number;
};

/** Stable id for a discovery object within a session — v0 uses session+ticker. */
export function discoveryObjectId(sessionDate: string, ticker: string): string {
  return `${sessionDate}:${ticker.toUpperCase()}`;
}

export function buildDiscoveryEvent(
  partial: Omit<DiscoveryEventPayload, "at_ms"> & { at_ms?: number }
): DiscoveryEventPayload {
  return {
    ...partial,
    ticker: partial.ticker.toUpperCase(),
    at_ms: partial.at_ms ?? Date.now(),
  };
}
