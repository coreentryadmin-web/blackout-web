/**
 * Night Hawk Legacy — explicit, deterministic setup-type classification (Workstream C / #20's
 * D2, 2026-09-21). No such field exists anywhere on ScoredCandidate/PlaybookPlay in this
 * pipeline today — this module is the real, capture-time classifier, replacing any need for a
 * later, after-the-fact heuristic. Rule-based, never learned: labels a candidate by whichever
 * scoring dimension dominates its total. Computed once and persisted, so every reader of a
 * candidate snapshot sees the SAME label rather than re-deriving it differently.
 *
 * Deliberately generic over a plain `{flow, tech, positioning, smart_money, news}` shape rather
 * than `ScoredCandidate` directly, because that is also the exact shape `PlaybookPlay.factor_
 * breakdown` already uses (deterministic-edition.ts) — a `rank_final` row can classify straight
 * from `play.factor_breakdown` with no adapter, while `scored`/`rank_governor`/rejected rows use
 * `setupTypeInputFromScored` to build the same shape from a live `ScoredCandidate`.
 */

import type { ScoredCandidate } from "./scorer";

export type SetupType =
  | "flow_led"
  | "technical_led"
  | "positioning_led"
  | "smart_money_led"
  | "catalyst_or_news_led"
  | "balanced"
  | "unknown";

/** When the top two dimension scores are within this margin, the setup is labeled "balanced"
 *  rather than arbitrarily crediting whichever happened to be marginally larger. */
export const SETUP_TYPE_BALANCED_MARGIN = 2;

export type SetupTypeInput = {
  flow?: number | null;
  tech?: number | null;
  positioning?: number | null;
  smart_money?: number | null;
  news?: number | null;
};

const DIMENSIONS: ReadonlyArray<{ key: keyof SetupTypeInput; label: SetupType }> = [
  { key: "flow", label: "flow_led" },
  { key: "tech", label: "technical_led" },
  { key: "positioning", label: "positioning_led" },
  { key: "smart_money", label: "smart_money_led" },
  { key: "news", label: "catalyst_or_news_led" },
];

/** Adapter from a live ScoredCandidate to the shared SetupTypeInput shape (the same field names
 *  PlaybookPlay.factor_breakdown already uses, so both inputs classify identically). */
export function setupTypeInputFromScored(
  scored: Pick<ScoredCandidate, "flow_score" | "tech_score" | "pos_score" | "smart_money_score" | "news_score">
): SetupTypeInput {
  return {
    flow: scored.flow_score,
    tech: scored.tech_score,
    positioning: scored.pos_score,
    smart_money: scored.smart_money_score,
    news: scored.news_score,
  };
}

/** Labels by whichever dimension is strictly largest; "balanced" when the top two are within
 *  SETUP_TYPE_BALANCED_MARGIN; "unknown" only when no dimension value is available at all (should
 *  not happen for a real ScoredCandidate/factor_breakdown, but never guessed). */
export function classifySetupType(input: SetupTypeInput): SetupType {
  const scored = DIMENSIONS.map(({ key, label }) => ({ label, value: input[key] })).filter(
    (d): d is { label: SetupType; value: number } => typeof d.value === "number" && Number.isFinite(d.value)
  );
  if (!scored.length) return "unknown";
  scored.sort((a, b) => b.value - a.value);
  const top = scored[0]!;
  const second = scored[1];
  if (second && top.value - second.value <= SETUP_TYPE_BALANCED_MARGIN) return "balanced";
  return top.label;
}
