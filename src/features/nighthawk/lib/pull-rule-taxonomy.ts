/**
 * Night Hawk Legacy Signal Intelligence, Phase 2B — classifies a morning-confirm pull's
 * `pulled_reason` text (morning-verdict-persist.ts's `Pulled pre-open${tag}: ${status.reason}`,
 * where `status.reason` is `computePlayVerdict`'s (morning-confirm-verdict.ts) semicolon-joined
 * list of whichever of its checks fired) into the SPECIFIC rule(s) that caused the pull.
 *
 * WHY THIS EXISTS: `debrief.ts`'s `classifyFailureMode` already tags a pulled play
 * `pulled_wrongly`/`pulled_correctly` (was the pull a real mistake, via the counterfactual
 * grade), but that tag alone can't answer the operator's standing mandate item #8 — "which
 * cancellation rule caused each winner to be pulled... identify rules destroying positive
 * expectancy" — because it doesn't say WHICH of `computePlayVerdict`'s several independent
 * checks did the pulling. `pulled_reason` is free text (deliberately — it's the member-facing
 * badge copy), so this module pattern-matches it back to a small, named rule taxonomy using the
 * EXACT sentence templates `computePlayVerdict` emits (see the RULE_PATTERNS table — each regex
 * is anchored to that file's own literal wording, guarded by this module's own tests against
 * every real template string so the two can't silently drift apart).
 *
 * A pull can match MULTIPLE rules at once — a severe-DEGRADED pull (>=2 combined reasons, see
 * `isDegradedSevere` in morning-verdict-persist.ts) genuinely had more than one check fire, and
 * attributing the pull to every contributing rule (not picking one arbitrarily) is the honest
 * read: if `regime_choppy` keeps showing up as A contributing factor in wrongly-pulled plays,
 * that is actionable regardless of what else co-fired alongside it.
 *
 * NULL/UNKNOWN-HONEST: no pattern match returns an empty array, never a guessed rule — a reason
 * string whose wording has drifted from these templates (e.g. after a future edit to
 * computePlayVerdict) shows up as unattributed in aggregation, not silently mis-bucketed.
 */

export const PULL_RULE_TAGS = [
  "stock_stop_through",
  "target_consumed_premarket",
  "spx_gap_against_direction",
  "spx_gap_generic",
  "contrary_anomalies_hard",
  "contrary_anomaly_soft",
  "anomaly_catchall",
  "regime_mismatch_hard",
  "regime_choppy",
  "gex_wall_shift_hard",
  "gex_wall_drift_soft",
  "single_name_no_data",
] as const;
export type PullRuleTag = (typeof PULL_RULE_TAGS)[number];

/** One entry per `computePlayVerdict` reason template. Order doesn't matter — every pattern is
 *  tested independently and ALL matches are returned (see header). Patterns are deliberately
 *  narrow (anchored substrings from the real template), not loose keyword matches. */
const RULE_PATTERNS: Array<{ tag: PullRuleTag; re: RegExp }> = [
  { tag: "stock_stop_through", re: /has gapped through the stop/i },
  { tag: "target_consumed_premarket", re: /already at\/through target/i },
  { tag: "spx_gap_against_direction", re: /SPX gapped [+-]?[\d.]+ pts against \w+ direction/i },
  { tag: "spx_gap_generic", re: /SPX gapped [+-]?[\d.]+ pts — verify entry levels/i },
  { tag: "contrary_anomalies_hard", re: /\d+ contrary flow anomalies detected/i },
  { tag: "contrary_anomaly_soft", re: /Contrary flow anomaly detected — reduce size/i },
  { tag: "anomaly_catchall", re: /active flow anomaly\(ies\) — elevated uncertainty/i },
  { tag: "regime_mismatch_hard", re: /contradicts (LONG|SHORT) direction/i },
  { tag: "regime_choppy", re: /choppy\/neutral reduces conviction/i },
  { tag: "gex_wall_shift_hard", re: /(Call|Put) wall shifted \d+ pts from edition/i },
  { tag: "gex_wall_drift_soft", re: /(Call|Put) wall drifted \d+ pts/i },
  { tag: "single_name_no_data", re: /pre-market price unavailable — SPX gap alone/i },
];

/** Every rule tag whose template appears in `reasonText` (the raw `pulled_reason` column, or
 *  any string containing `computePlayVerdict`'s reason sentences — the match doesn't care about
 *  the `Pulled pre-open (...): ` wrapper morning-verdict-persist.ts adds). Empty array (never a
 *  guess) when nothing recognizable matched, including a null/empty input. */
export function classifyPullRules(reasonText: string | null | undefined): PullRuleTag[] {
  if (!reasonText) return [];
  const found: PullRuleTag[] = [];
  for (const { tag, re } of RULE_PATTERNS) {
    if (re.test(reasonText) && !found.includes(tag)) found.push(tag);
  }
  return found;
}
