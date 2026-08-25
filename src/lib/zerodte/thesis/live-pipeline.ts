import type { EnrichedZeroDteSetup } from "../board";
import type { ZeroDteGateBlock } from "../gates";
import { evaluateArchetypeGates } from "./archetype-gates";
import { mergeScanPassTheses, runThesisPipelineForSetup } from "./pipeline";
import type { ThesisPipelineResult } from "./types";
import { thesisFirstEnv } from "./types";

/** Fail-closed commit blocks from thesis + archetype gates (live path only). */
export function thesisFirstCommitBlocks(result: ThesisPipelineResult): string[] {
  const blocks: string[] = [];
  if (result.rank_tier === "REJECT") blocks.push("thesis_rank_reject");
  if (result.archetype_gates.verdict === "BLOCK") {
    for (const b of result.archetype_gates.blocks) blocks.push(`thesis_${b}`);
  }
  return blocks;
}

export function thesisBlocksToGateBlocks(codes: string[]): ZeroDteGateBlock[] {
  return codes.map((code) => ({
    code: code === "thesis_rank_reject" ? "thesis_rank_reject" : "thesis_archetype_block",
    reason: code.replace(/^thesis_/, "Thesis: "),
    threshold: null,
    unlock_et: null,
  }));
}

/** Stamp thesis pipeline + optional pre-gate blocks when live path is armed. */
export function attachThesisFirstLive(
  setups: EnrichedZeroDteSetup[],
  nowEtMinutes?: number
): void {
  const env = thesisFirstEnv();
  if (!env.enabled && !env.shadow) return;

  const mergedByTicker = mergeScanPassTheses(setups);

  for (const s of setups) {
    const merged = mergedByTicker.get(s.ticker.toUpperCase());
    let pipeline = runThesisPipelineForSetup(s);
    if (merged) pipeline = { ...pipeline, thesis: merged };

    if (nowEtMinutes != null) {
      pipeline = {
        ...pipeline,
        archetype_gates: evaluateArchetypeGates({
          archetype: pipeline.thesis.trade_archetype,
          rail_scores: pipeline.thesis.rail_scores,
          structural_state: pipeline.thesis.structural_state,
          flow_class:
            pipeline.thesis.summaries.FLOW != null
              ? pipeline.thesis.rail_scores.FLOW != null && (s.gross_premium ?? 0) >= 1_500_000
                ? "CAMPAIGN"
                : "EVENT"
              : null,
          et_minutes: nowEtMinutes,
        }),
      };
      let rank_tier = pipeline.rank_tier;
      if (pipeline.archetype_gates.verdict === "BLOCK") rank_tier = "REJECT";
      else if (pipeline.thesis.archetype_score >= 85 && pipeline.thesis.systems_aligned >= 4)
        rank_tier = "A+";
      else if (pipeline.thesis.archetype_score >= 75 && pipeline.archetype_gates.verdict === "PASS")
        rank_tier = "A";
      else if (pipeline.thesis.archetype_score >= 65) rank_tier = "B";
      else rank_tier = "WATCH";
      pipeline = { ...pipeline, rank_tier };
    }

    s.thesis_first = pipeline;

    if (env.enabled) {
      const blocks = thesisFirstCommitBlocks(pipeline);
      if (blocks.length > 0) s.thesis_gate_blocks = blocks;
    }
  }
}
