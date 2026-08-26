import type { EnrichedZeroDteSetup } from "../board";
import type { ZeroDteGateBlock } from "../gates";
import { evaluateArchetypeGates } from "./archetype-gates";
import { deskEvidenceFromPipeline } from "./desk-evidence-lines";
import { mergeLegacyBridgeExtras } from "./evidence-bundle-map";
import { mergeScanPassTheses, runThesisPipelineForSetup } from "./pipeline";
import { legacyBridgeExtrasFromSetup } from "./rails/legacy-bridge";
import { syncSetupDiscoveryFromThesis } from "./thesis-board-sync";
import type { ThesisPipelineResult, ThesisRankTier } from "./types";
import { thesisFirstEnv } from "./types";

/** Solo BREAKOUT without FLOW/MOMENTUM corroboration must not rank A — the pre-thesis quality hole. */
export function resolveThesisRankTier(
  thesis: ThesisPipelineResult["thesis"],
  archetype_gates: ThesisPipelineResult["archetype_gates"]
): ThesisRankTier {
  if (archetype_gates.verdict === "BLOCK") return "REJECT";
  if (thesis.archetype_score >= 85 && thesis.systems_aligned >= 4) return "A+";
  if (thesis.archetype_score >= 75 && archetype_gates.verdict === "PASS") {
    if (soloBreakoutNeedsCorroboration(thesis)) return "WATCH";
    return "A";
  }
  if (thesis.archetype_score >= 65) return "B";
  return "WATCH";
}

function soloBreakoutNeedsCorroboration(thesis: ThesisPipelineResult["thesis"]): boolean {
  if (thesis.disagreeing_rails.length > 0) return true;
  if (thesis.trade_archetype !== "BREAKOUT") return false;
  if (thesis.systems_aligned > 1) return false;
  const flow = thesis.rail_scores.FLOW ?? 0;
  const mom = thesis.rail_scores.MOMENTUM ?? 0;
  return flow < 55 && mom < 55;
}

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
  nowEtMinutes?: number,
  extrasByTicker: Record<string, import("./rails/legacy-bridge").LegacyBridgeExtras> = {}
): void {
  const env = thesisFirstEnv();
  if (!env.enabled && !env.shadow) return;

  const mergedByTicker = mergeScanPassTheses(setups, extrasByTicker);

  for (const s of setups) {
    const tickerKey = s.ticker.toUpperCase();
    const mergedExtras = mergeLegacyBridgeExtras(
      legacyBridgeExtrasFromSetup(s),
      extrasByTicker[tickerKey] ?? {},
    );
    const merged = mergedByTicker.get(tickerKey);
    let pipeline = runThesisPipelineForSetup(s, mergedExtras);
    if (merged) pipeline = { ...pipeline, thesis: merged };

    syncSetupDiscoveryFromThesis(s, pipeline.thesis);

    // MUST run unconditionally, not gated on `nowEtMinutes != null`: `pipeline.thesis` may have
    // just been swapped to the ticker-merged, multi-setup `merged` thesis above, but
    // `archetype_gates`/`rank_tier` up to this point still reflect the DISCARDED single-setup
    // thesis from runThesisPipelineForSetup. Skipping this recompute when `nowEtMinutes` is
    // omitted used to leave `s.thesis_first` internally inconsistent — thesis from the merge,
    // tier/gates from the pre-merge view (found 2026-08-26; latent — every current caller
    // supplies nowEtMinutes, so this never misfired live, but a future shadow-mode caller
    // omitting it would silently ship the mismatch). `et_minutes` is optional on
    // evaluateArchetypeGates (only gates the `pre_1000_et` WATCH note), so passing it through
    // as possibly-undefined changes nothing when `nowEtMinutes` IS supplied.
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
    pipeline = { ...pipeline, rank_tier: resolveThesisRankTier(pipeline.thesis, pipeline.archetype_gates) };

    pipeline = {
      ...pipeline,
      desk_evidence: deskEvidenceFromPipeline(pipeline, mergedExtras),
    };

    s.thesis_first = pipeline;

    if (env.enabled) {
      const blocks = thesisFirstCommitBlocks(pipeline);
      if (blocks.length > 0) s.thesis_gate_blocks = blocks;
    }
  }
}
