// Direction-failure diagnosis (2026-09-23, operator directive: "trace every wrong_direction
// play... determine whether the failures are coming from flow-first direction precedence,
// market/regime conflict, structure vs flow disagreement, setup-specific direction failures,
// stale or conflicting signals, entry timing/window problems, scoring/ranking selecting the
// wrong side"). DIAGNOSIS ONLY — this module reads already-graded, already-pinned history and
// classifies it. It changes nothing about live scoring/ranking/direction logic.
//
// WHY THIS SHAPE: scorer.ts's scoreFlowQuality (the ONLY place `direction` is decided) picks
// the side with more call-weighted vs put-weighted premium, with a narrow-margin skew override
// — every OTHER scoring dimension (tech/positioning/wall/vex/dealer/catalyst/smart-money) then
// only measures AGREEMENT with that already-chosen direction; none of them can independently
// flip it except the same thin-margin skew check. So "was the direction call wrong because flow
// overruled everything else" is directly testable from the pinned per-dimension score breakdown
// (publish_context.confluence, confluenceSnapshot()) WITHOUT needing the raw historical flow
// tape: a wrong-direction play whose tech_score is low/zero/negative while flow_score dominates
// the total is empirical evidence flow carried a pick that structure never corroborated.
//
// DATA GAP, DISCLOSED HONESTLY: `flowMargin` (how close call vs put premium actually was) and
// `directionFlippedBySkew` are computed live in scoreFlowQuality but NEVER pinned to
// publish_context — so "was this a near-coin-flip flow call" cannot be reconstructed for
// historical rows from this data alone. Flagged in the report rather than guessed at or
// silently reconstructed from a fresh (rate-limited) UW re-fetch.
//
// Pure module: no I/O, no db imports — operates on the same DebriefAggregateRow[] the debrief
// aggregate report already fetches (db.fetchNighthawkOutcomeAnalytics), so the diagnosis route
// needs no new DB query.

import type { DebriefAggregateRow } from "./debrief-aggregate";
import { readPinnedDebriefTag, readPinnedTierAssignment, pinnedTargetAtrMultiple } from "./debrief-aggregate";
import { GATE_TARGET_MAX_ATR_MULTIPLE } from "./publish-gates";

export const DIRECTION_FAILURE_CAUSES = [
  "flow_dominant_weak_structure",
  "regime_conflict",
  "structure_vs_flow_disagreement",
  "catalyst_or_fundamental_conflict",
  "gate_promoted_marginal",
  "overreaching_target",
  "thin_confluence",
  "unclassified",
] as const;
export type DirectionFailureCause = (typeof DIRECTION_FAILURE_CAUSES)[number];

/** A play is scoreable for this diagnosis when it reached a WIN/LOSS decision (unfilled/pulled/
 *  open/ambiguous rows carry no directional verdict to explain) AND carries a usable pin. */
export type DirectionDiagnosisRow = {
  ticker: string;
  edition_for: string;
  direction: string | null;
  conviction: string | null;
  outcome: string | null;
  debrief_tag: string | null;
  is_wrong_direction: boolean;
  /** True for the comparison cohort: a decided WIN, or a debrief tag naming a genuine correct
   *  call (clean_win/lucky_win/pulled_correctly) — never inferred from outcome alone, since a
   *  `stop` can still be `stopped_normal` (right idea, adverse swing) rather than wrong-direction. */
  is_comparison_winner: boolean;
  causes: DirectionFailureCause[];
  evidence: {
    total_score: number | null;
    flow_score: number | null;
    tech_score: number | null;
    pos_score: number | null;
    smart_money_score: number | null;
    /** flow_score as a fraction of total_score — null when total_score<=0. */
    flow_dominance_pct: number | null;
    tide_bias: string | null;
    composite_regime: string | null;
    /** True when tide_bias/composite_regime's directional lean opposes the play's own direction
     *  (composite_regime check uses the CORRECTED comp.includes("DOWN"/"UP") rule from #30's
     *  shadow-log, not the live buggy BEARISH/NEGATIVE string match, since the live gate is
     *  known dead code and would silently under-report every regime conflict here). */
    regime_conflicts_with_direction: boolean;
    earnings_risk: boolean;
    catalyst_flags: string[];
    fundamental_block: boolean;
    fundamental_flags: string[];
    tier: string | null;
    gate_promoted: boolean;
    target_atr_multiple: number | null;
    over_target_atr_gate: boolean;
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function confluence(publishContext: unknown): Record<string, unknown> | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const c = (publishContext as Record<string, unknown>).confluence;
  return c != null && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
}

function marketBlock(publishContext: unknown): Record<string, unknown> | null {
  if (publishContext == null || typeof publishContext !== "object" || Array.isArray(publishContext)) return null;
  const m = (publishContext as Record<string, unknown>).market;
  return m != null && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

/** Mirrors #30's shadow-log CORRECTED gate (comp.includes("DOWN")/("UP")) — the live production
 *  string match (BEARISH/NEGATIVE) can never fire on derive-composite.ts's real 7-value enum, so
 *  using it here would silently hide every real regime conflict behind a dead check. Duplicated,
 *  not imported, to keep this module's own drift-guard test independent of bearish-posture-shadow's. */
function regimeConflictsWithDirection(direction: string | null, tideBias: string | null, compositeRegime: string | null): boolean {
  const dir = (direction ?? "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return false;
  const tide = (tideBias ?? "").toUpperCase();
  if (dir === "LONG" && tide === "BEARISH") return true;
  if (dir === "SHORT" && tide === "BULLISH") return true;
  const comp = (compositeRegime ?? "").toUpperCase();
  if (!comp) return false;
  const compBearish = comp.includes("DOWN");
  const compBullish = comp.includes("UP") && !comp.includes("BREAKDOWN");
  if (dir === "LONG" && compBearish) return true;
  if (dir === "SHORT" && compBullish) return true;
  return false;
}

const FLOW_DOMINANCE_THRESHOLD = 0.5;
const WEAK_STRUCTURE_TECH_SCORE = 3;
const THIN_CONFLUENCE_SCORE = 20;

/** Classify ONE row's evidence + causes. Pure; never throws on malformed pins (missing/absent
 *  publish_context degrades every evidence field to null, cause list stays whatever IS
 *  determinable — never fabricated). */
export function diagnoseDirectionRow(row: DebriefAggregateRow): DirectionDiagnosisRow {
  const tag = readPinnedDebriefTag(row.debrief ?? null);
  const isWrongDirection = tag === "wrong_direction";
  const isComparisonWinner = tag === "clean_win" || tag === "lucky_win" || tag === "pulled_correctly";

  const conf = confluence(row.publish_context ?? null);
  const market = marketBlock(row.publish_context ?? null);
  const tierAssignment = readPinnedTierAssignment(row.publish_context ?? null);
  const targetAtr = pinnedTargetAtrMultiple(row.publish_context ?? null);

  const totalScore = num(conf?.total_score);
  const flowScore = num(conf?.flow_score);
  const techScore = num(conf?.tech_score);
  const posScore = num(conf?.pos_score);
  const smartMoneyScore = num(conf?.smart_money_score);
  const tideBias = typeof market?.tide_bias === "string" ? market.tide_bias : null;
  const compositeRegime = typeof market?.composite_regime === "string" ? market.composite_regime : null;
  const earningsRisk = bool(conf?.earnings_risk);
  const catalystFlags = strArr(conf?.catalyst_flags);
  const fundamentalBlock = bool(conf?.fundamental_block);
  const fundamentalFlags = strArr(conf?.fundamental_flags);
  const gatePromoted = row.publish_context != null
    && typeof row.publish_context === "object"
    && !Array.isArray(row.publish_context)
    ? bool((row.publish_context as Record<string, unknown>).gate_promoted)
    : false;

  const flowDominancePct =
    totalScore != null && totalScore > 0 && flowScore != null ? Math.round((flowScore / totalScore) * 1000) / 10 : null;
  const regimeConflict = regimeConflictsWithDirection(row.direction, tideBias, compositeRegime);
  const overTargetAtrGate = targetAtr != null && targetAtr > GATE_TARGET_MAX_ATR_MULTIPLE;

  const causes: DirectionFailureCause[] = [];
  if (regimeConflict) causes.push("regime_conflict");
  if (
    flowDominancePct != null
    && flowDominancePct / 100 >= FLOW_DOMINANCE_THRESHOLD
    && techScore != null
    && techScore <= WEAK_STRUCTURE_TECH_SCORE
  ) {
    causes.push("flow_dominant_weak_structure");
    causes.push("structure_vs_flow_disagreement");
  }
  if (earningsRisk || catalystFlags.length > 0 || fundamentalBlock || fundamentalFlags.length > 0) {
    causes.push("catalyst_or_fundamental_conflict");
  }
  if (gatePromoted) causes.push("gate_promoted_marginal");
  if (overTargetAtrGate) causes.push("overreaching_target");
  if (totalScore != null && totalScore < THIN_CONFLUENCE_SCORE) causes.push("thin_confluence");
  if (causes.length === 0) causes.push("unclassified");

  return {
    ticker: row.ticker,
    edition_for: row.edition_for,
    direction: row.direction,
    conviction: row.conviction,
    outcome: row.outcome,
    debrief_tag: tag,
    is_wrong_direction: isWrongDirection,
    is_comparison_winner: isComparisonWinner,
    causes,
    evidence: {
      total_score: totalScore,
      flow_score: flowScore,
      tech_score: techScore,
      pos_score: posScore,
      smart_money_score: smartMoneyScore,
      flow_dominance_pct: flowDominancePct,
      tide_bias: tideBias,
      composite_regime: compositeRegime,
      regime_conflicts_with_direction: regimeConflict,
      earnings_risk: earningsRisk,
      catalyst_flags: catalystFlags,
      fundamental_block: fundamentalBlock,
      fundamental_flags: fundamentalFlags,
      tier: tierAssignment?.tier ?? null,
      gate_promoted: gatePromoted,
      target_atr_multiple: targetAtr,
      over_target_atr_gate: overTargetAtrGate,
    },
  };
}

export type DirectionFailureCauseCount = { cause: DirectionFailureCause; n: number; pct_of_wrong_direction: number };

export type CohortMeans = {
  n: number;
  mean_total_score: number | null;
  mean_flow_score: number | null;
  mean_tech_score: number | null;
  mean_pos_score: number | null;
  mean_smart_money_score: number | null;
  mean_flow_dominance_pct: number | null;
  regime_conflict_rate_pct: number | null;
  catalyst_or_fundamental_conflict_rate_pct: number | null;
  gate_promoted_rate_pct: number | null;
  over_target_atr_gate_rate_pct: number | null;
};

export type DirectionFailureDiagnosisReport = {
  window: { days: number };
  wrong_direction_n: number;
  comparison_winner_n: number;
  cause_breakdown: DirectionFailureCauseCount[];
  wrong_direction_cohort: CohortMeans;
  winner_cohort: CohortMeans;
  rows: DirectionDiagnosisRow[];
  low_n: boolean;
};

const LOW_N_FLOOR = 10;

function mean(values: Array<number | null>): number | null {
  const usable = values.filter((v): v is number => v != null);
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((a, b) => a + b, 0) / usable.length) * 100) / 100;
}

function rate(values: boolean[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.filter(Boolean).length / values.length) * 1000) / 10;
}

function cohortMeans(rows: DirectionDiagnosisRow[]): CohortMeans {
  return {
    n: rows.length,
    mean_total_score: mean(rows.map((r) => r.evidence.total_score)),
    mean_flow_score: mean(rows.map((r) => r.evidence.flow_score)),
    mean_tech_score: mean(rows.map((r) => r.evidence.tech_score)),
    mean_pos_score: mean(rows.map((r) => r.evidence.pos_score)),
    mean_smart_money_score: mean(rows.map((r) => r.evidence.smart_money_score)),
    mean_flow_dominance_pct: mean(rows.map((r) => r.evidence.flow_dominance_pct)),
    regime_conflict_rate_pct: rate(rows.map((r) => r.evidence.regime_conflicts_with_direction)),
    catalyst_or_fundamental_conflict_rate_pct: rate(
      rows.map(
        (r) => r.evidence.earnings_risk || r.evidence.catalyst_flags.length > 0 || r.evidence.fundamental_block
      )
    ),
    gate_promoted_rate_pct: rate(rows.map((r) => r.evidence.gate_promoted)),
    over_target_atr_gate_rate_pct: rate(rows.map((r) => r.evidence.over_target_atr_gate)),
  };
}

/** Diagnose a whole window's worth of graded rows. Pure; deterministic. `rows` should already
 *  be filtered to CURRENT grade methodology by the caller (same anti-blend rule as every other
 *  debrief-aggregate cut) — this function does not re-filter. */
export function diagnoseDirectionFailures(rows: DebriefAggregateRow[], days: number): DirectionFailureDiagnosisReport {
  const diagnosed = rows.map(diagnoseDirectionRow);
  const wrongDirection = diagnosed.filter((r) => r.is_wrong_direction);
  const winners = diagnosed.filter((r) => r.is_comparison_winner);

  const causeCounts = new Map<DirectionFailureCause, number>();
  for (const r of wrongDirection) {
    for (const c of r.causes) causeCounts.set(c, (causeCounts.get(c) ?? 0) + 1);
  }
  const causeBreakdown: DirectionFailureCauseCount[] = Array.from(causeCounts.entries())
    .map(([cause, n]) => ({
      cause,
      n,
      pct_of_wrong_direction: wrongDirection.length > 0 ? Math.round((n / wrongDirection.length) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.n - a.n);

  return {
    window: { days },
    wrong_direction_n: wrongDirection.length,
    comparison_winner_n: winners.length,
    cause_breakdown: causeBreakdown,
    wrong_direction_cohort: cohortMeans(wrongDirection),
    winner_cohort: cohortMeans(winners),
    rows: [...wrongDirection, ...winners],
    low_n: wrongDirection.length < LOW_N_FLOOR || winners.length < LOW_N_FLOOR,
  };
}
