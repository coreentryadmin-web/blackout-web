import type { RailScoreMap, StructuralState, TradeArchetype, ThesisRail } from "./types";

export type ArchetypeMatch = {
  archetype: TradeArchetype;
  confidence: number;
  secondary?: TradeArchetype | null;
};

type ArchetypeRule = {
  archetype: TradeArchetype;
  core: ThesisRail[];
  minCoreAvg: number;
};

const RULES: ArchetypeRule[] = [
  { archetype: "FLOW_FOLLOWING", core: ["FLOW", "RS"], minCoreAvg: 65 },
  { archetype: "MOMENTUM_CONTINUATION", core: ["MOMENTUM", "RS"], minCoreAvg: 65 },
  { archetype: "BREAKOUT", core: ["BREAKOUT", "MOMENTUM"], minCoreAvg: 60 },
  { archetype: "MEAN_REVERSION", core: ["REVERSAL", "POSITIONING"], minCoreAvg: 60 },
  { archetype: "GAMMA_BREAK", core: ["POSITIONING", "BREAKOUT"], minCoreAvg: 60 },
  { archetype: "CATALYST_CONTINUATION", core: ["CATALYST", "BREAKOUT", "FLOW"], minCoreAvg: 55 },
  { archetype: "FAILED_BREAKOUT", core: ["REVERSAL", "BREAKOUT"], minCoreAvg: 55 },
  { archetype: "VOL_EXPANSION", core: ["BREAKOUT", "VOL", "MOMENTUM"], minCoreAvg: 55 },
];

function avg(scores: RailScoreMap, rails: ThesisRail[]): number {
  const vals = rails.map((r) => scores[r]).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function scoreArchetype(rule: ArchetypeRule, scores: RailScoreMap, structural: StructuralState): number {
  const present = rule.core.filter((r) => scores[r] != null);
  if (present.length < Math.min(2, rule.core.length)) return 0;
  const base = avg(scores, present);
  if (base < rule.minCoreAvg) return 0;
  let bonus = 0;
  if (rule.archetype === "BREAKOUT" && structural === "TRIGGERED") bonus += 8;
  if (rule.archetype === "BREAKOUT" && structural === "COILED") bonus += 4;
  if (rule.archetype === "VOL_EXPANSION" && structural === "COILED") bonus += 6;
  return Math.min(100, Math.round(base + bonus));
}

/** Classify trade archetype from rail scores — deterministic, calibration-first weights TBD. */
export function classifyTradeArchetype(
  scores: RailScoreMap,
  structural: StructuralState = null
): ArchetypeMatch {
  let best: ArchetypeMatch = { archetype: "MOMENTUM_CONTINUATION", confidence: 0, secondary: null };
  let secondBest: { archetype: TradeArchetype; confidence: number } | null = null;

  for (const rule of RULES) {
    const confidence = scoreArchetype(rule, scores, structural);
    if (confidence > best.confidence) {
      if (best.confidence > 0) {
        secondBest = { archetype: best.archetype, confidence: best.confidence };
      }
      best = { archetype: rule.archetype, confidence, secondary: null };
    } else if (secondBest == null || confidence > secondBest.confidence) {
      if (confidence > 0 && rule.archetype !== best.archetype) {
        secondBest = { archetype: rule.archetype, confidence };
      }
    }
  }

  if (best.confidence === 0) {
    const fallbackRail = (["RS", "MOMENTUM", "FLOW", "BREAKOUT"] as ThesisRail[]).find((r) => (scores[r] ?? 0) > 0);
    const fallbackScore = fallbackRail ? scores[fallbackRail]! : 50;
    best = {
      archetype: fallbackRail === "FLOW" ? "FLOW_FOLLOWING" : fallbackRail === "BREAKOUT" ? "BREAKOUT" : "MOMENTUM_CONTINUATION",
      confidence: Math.round(fallbackScore),
      secondary: null,
    };
  } else if (secondBest && secondBest.confidence >= best.confidence - 8) {
    best.secondary = secondBest.archetype;
  }

  return best;
}

/** Archetype-specific score from core rails (NOT a generic blend of all rails). */
export function scoreForArchetype(archetype: TradeArchetype, scores: RailScoreMap, structural: StructuralState): number {
  const rule = RULES.find((r) => r.archetype === archetype);
  if (!rule) return 0;
  return scoreArchetype(rule, scores, structural);
}

export const ARCHETYPE_LABEL: Record<TradeArchetype, string> = {
  MOMENTUM_CONTINUATION: "Momentum Continuation",
  BREAKOUT: "Breakout",
  FLOW_FOLLOWING: "Flow Following",
  MEAN_REVERSION: "Mean Reversion",
  GAMMA_BREAK: "Gamma Break",
  CATALYST_CONTINUATION: "Catalyst Continuation",
  FAILED_BREAKOUT: "Failed Breakout",
  VOL_EXPANSION: "Vol Expansion",
};
