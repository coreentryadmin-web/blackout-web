import type { EnrichedZeroDteSetup } from "../board";
import { attachThesisFirstLive } from "./live-pipeline";
import type { ThesisPipelineResult } from "./types";
import { thesisFirstEnv } from "./types";

/** Attach thesis-first pipeline snapshot to each setup (shadow by default). */
export function attachThesisFirstShadow(
  setups: EnrichedZeroDteSetup[],
  nowEtMinutes?: number
): void {
  const env = thesisFirstEnv();
  if (!env.enabled && !env.shadow) return;
  attachThesisFirstLive(setups, nowEtMinutes);
}

/** Compact blob for entry_context persistence at commit. */
export function thesisFirstEntryContext(
  pipeline: ThesisPipelineResult | null | undefined
): Record<string, unknown> | null {
  if (!pipeline) return null;
  const { thesis, rank_tier, archetype_gates, expression } = pipeline;
  return {
    rail_scores: thesis.rail_scores,
    rails_fired: thesis.rails_fired,
    systems_aligned: thesis.systems_aligned,
    trade_archetype: thesis.trade_archetype,
    archetype_score: thesis.archetype_score,
    structural_state: thesis.structural_state,
    trigger_price: thesis.trigger_price,
    rank_tier,
    archetype_gate: archetype_gates.verdict,
    archetype_blocks: archetype_gates.blocks,
    ...(expression?.contract
      ? {
          expression_horizon: expression.horizon,
          expression_dte: expression.dte_target,
          expression_strike: expression.contract.strike,
          expression_expiry: expression.contract.expiry,
          expression_score: expression.contract_score,
          expression_rationale: expression.rationale,
        }
      : {}),
  };
}
