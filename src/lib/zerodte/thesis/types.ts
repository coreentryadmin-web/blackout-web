/**
 * Thesis-first pipeline types — discovery is DTE-agnostic; expression is separate.
 * See docs/audit/THESIS-FIRST-PIPELINE.md.
 */

/** Independent discovery rails (superset of legacy DiscoveryOrigin). */
export type ThesisRail =
  | "FLOW"
  | "MOMENTUM"
  | "RS"
  | "BREAKOUT"
  | "REVERSAL"
  | "POSITIONING"
  | "CATALYST"
  | "VOL";

export const THESIS_RAIL_ORDER: readonly ThesisRail[] = [
  "FLOW",
  "MOMENTUM",
  "RS",
  "BREAKOUT",
  "REVERSAL",
  "POSITIONING",
  "CATALYST",
  "VOL",
];

/** Core trade archetypes — each has its own score model + gates. */
export type TradeArchetype =
  | "MOMENTUM_CONTINUATION"
  | "BREAKOUT"
  | "FLOW_FOLLOWING"
  | "MEAN_REVERSION"
  | "GAMMA_BREAK"
  | "CATALYST_CONTINUATION"
  | "FAILED_BREAKOUT"
  | "VOL_EXPANSION";

export type FlowClass = "EVENT" | "CAMPAIGN";

export type StructuralState = "COILED" | "TRIGGERED" | "EXTENDED" | null;

export type PositioningArchetype =
  | "WALL_BREAK"
  | "WALL_REJECTION"
  | "GAMMA_FLIP"
  | "PIN"
  | "VACUUM";

export type CortexVerdictKind = "COMMIT" | "WATCH" | "REJECT";

export type ArchetypeGateVerdict = "PASS" | "WATCH" | "BLOCK";

/** One rail's independent read on a ticker. */
export type RailHit = {
  rail: ThesisRail;
  ticker: string;
  direction: "long" | "short";
  score: number;
  summary: string;
  flow_class?: FlowClass | null;
  structural_state?: StructuralState;
  positioning_archetype?: PositioningArchetype | null;
  meta?: Record<string, string | number | boolean | null>;
};

export type RailScoreMap = Partial<Record<ThesisRail, number>>;

export type MergedThesis = {
  ticker: string;
  direction: "long" | "short";
  rail_scores: RailScoreMap;
  rails_fired: ThesisRail[];
  systems_aligned: number;
  trade_archetype: TradeArchetype;
  archetype_score: number;
  structural_state: StructuralState;
  trigger_price: number | null;
  summaries: Partial<Record<ThesisRail, string>>;
};

export type ArchetypeGateResult = {
  verdict: ArchetypeGateVerdict;
  archetype: TradeArchetype;
  blocks: string[];
  notes: string[];
};

export type ContractCandidateInput = {
  expiry: string;
  strike: number;
  dte: number;
  side: "call" | "put";
  bid: number | null;
  ask: number | null;
  oi: number;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
};

export type ContractCandidate = ContractCandidateInput & {
  score: number;
  spread_pct: number | null;
  reasons: string[];
};

export type ExpressionDecision = {
  horizon: "ZERO_DTE" | "SWING" | "BANGER" | "CONDOR" | "NONE";
  dte_target: number | null;
  contract: ContractCandidate | null;
  contract_score: number;
  alternatives: ContractCandidate[];
  vol_rationale: string | null;
  rationale: string;
};

export type ThesisRankTier = "A+" | "A" | "B" | "WATCH" | "REJECT";

export type ThesisPipelineResult = {
  thesis: MergedThesis;
  archetype_gates: ArchetypeGateResult;
  expression: ExpressionDecision | null;
  rank_tier: ThesisRankTier;
};

export type ThesisFirstEnv = {
  enabled: boolean;
  shadow: boolean;
};

export function thesisFirstEnv(): ThesisFirstEnv {
  const raw = process.env.ZERODTE_THESIS_FIRST?.trim().toLowerCase();
  const shadowRaw = process.env.ZERODTE_THESIS_FIRST_SHADOW?.trim().toLowerCase();
  const enabled = raw === "1" || raw === "true" || raw === "on";
  if (enabled) return { enabled: true, shadow: false };
  const shadowOff = shadowRaw === "0" || shadowRaw === "false" || shadowRaw === "off";
  return { enabled: false, shadow: !shadowOff };
}

/** Map legacy PIN origin to POSITIONING rail. */
export function legacyOriginToRail(origin: string): ThesisRail | null {
  switch (origin) {
    case "FLOW":
      return "FLOW";
    case "BREAKOUT":
      return "BREAKOUT";
    case "PIN":
      return "POSITIONING";
    default:
      return null;
  }
}
