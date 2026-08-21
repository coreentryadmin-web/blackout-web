/**
 * PHASE SPLIT for a Largo turn: how much of the wall clock was PREFETCH vs the MODEL LOOP.
 *
 * A turn has two serial spans:
 *   - PREFETCH — the deterministic pre-loop work: `prefetchLargoTurnCaches` + `prepareLargoTurn`
 *     (live-feed capture, platform-vitals, desk-scope packs). No model call happens here.
 *   - LOOP — `anthropicToolLoop`: the Anthropic rounds plus any in-loop tool calls.
 *
 * WHY THIS EXISTS. On 2026-08-21 Largo turns ran ~30s and a large fraction blew `loopBudgetMs`
 * (30s Concrete / 75s Deep) and fell back to the empty-answer message. The interaction log records
 * exactly ONE number — total `latency_ms` (turn-outcome.ts) — which cannot say whether the time
 * went to a slow prefetch READ or to slow Anthropic ROUNDS. Those have opposite fixes (a degraded
 * upstream product-reader vs Anthropic round latency), so the single total is the wrong instrument
 * for the one question a slow spell forces. This emits the two spans so the next one is diagnosable
 * from logs — instead of by probing the live agent, which adds to the same AI-spend ledger the
 * probing is trying to reason about and perturbs the very latency it is trying to measure.
 *
 * CONTENT-FREE BY CONSTRUCTION: numbers, depth label and counts only — never the question, ticker
 * or user id — matching the per-tool diagnostics rule in `tool-guard.ts`. Safe to ship to logs.
 */

export type TurnPhaseTimings = {
  depth: string;
  prefetch_ms: number;
  loop_ms: number;
  total_ms: number;
  /** Distinct tools that ran this turn (prefetch labels + any in-loop calls). Count only. */
  tools: number;
  /** Did the loop return usable text, or did the turn fall through to the empty-answer fallback? */
  answered: boolean;
};

/**
 * Pure: derive the two spans from three clock reads. Spans are clamped at 0 — `Date.now()` can step
 * backward on an NTP adjustment, and a negative millisecond count in a log is noise, not signal.
 * The reads are expected contiguous (`startedAt <= loopStartedAt <= endedAt`), so on a healthy
 * clock `total_ms === prefetch_ms + loop_ms`; the test pins that identity.
 */
export function summarizeTurnPhases(input: {
  depth: string;
  startedAt: number;
  loopStartedAt: number;
  endedAt: number;
  toolCount: number;
  answered: boolean;
}): TurnPhaseTimings {
  return {
    depth: input.depth,
    prefetch_ms: Math.max(0, input.loopStartedAt - input.startedAt),
    loop_ms: Math.max(0, input.endedAt - input.loopStartedAt),
    total_ms: Math.max(0, input.endedAt - input.startedAt),
    tools: input.toolCount,
    answered: input.answered,
  };
}

/**
 * Emit the split as a single structured line, `console.info` like the per-tool timings, so it lands
 * in CloudWatch and greps cleanly on the `[largo/turn-phases]` tag.
 */
export function logTurnPhases(t: TurnPhaseTimings): void {
  console.info("[largo/turn-phases]", JSON.stringify(t));
}
