import type { ArchetypeGateResult, ArchetypeGateVerdict, RailScoreMap, StructuralState, TradeArchetype } from "./types";

export type ArchetypeGateInput = {
  archetype: TradeArchetype;
  rail_scores: RailScoreMap;
  structural_state: StructuralState;
  flow_class?: "EVENT" | "CAMPAIGN" | null;
  et_minutes?: number;
};

function rs(scores: RailScoreMap): number {
  return scores.RS ?? 0;
}
function flow(scores: RailScoreMap): number {
  return scores.FLOW ?? 0;
}
function breakout(scores: RailScoreMap): number {
  return scores.BREAKOUT ?? 0;
}
function reversal(scores: RailScoreMap): number {
  return scores.REVERSAL ?? 0;
}
function positioning(scores: RailScoreMap): number {
  return scores.POSITIONING ?? 0;
}

/** Per-archetype gates — a good reversal ≠ a good momentum trade. */
export function evaluateArchetypeGates(input: ArchetypeGateInput): ArchetypeGateResult {
  const blocks: string[] = [];
  const notes: string[] = [];
  let verdict: ArchetypeGateVerdict = "PASS";

  const pushBlock = (code: string) => {
    blocks.push(code);
    verdict = "BLOCK";
  };
  const pushWatch = (code: string) => {
    notes.push(code);
    if (verdict === "PASS") verdict = "WATCH";
  };

  switch (input.archetype) {
    case "MOMENTUM_CONTINUATION": {
      if (rs(input.rail_scores) < 55) pushBlock("momentum_rs_floor");
      if ((input.rail_scores.MOMENTUM ?? 0) < 60) pushBlock("momentum_abs_floor");
      break;
    }
    case "BREAKOUT": {
      if (input.structural_state === "COILED") pushWatch("breakout_coiled_pre_trigger");
      if (input.structural_state !== "TRIGGERED" && breakout(input.rail_scores) >= 70) {
        pushWatch("breakout_unconfirmed");
      }
      if (breakout(input.rail_scores) < 55) pushBlock("breakout_score_floor");
      break;
    }
    case "FLOW_FOLLOWING": {
      if (input.flow_class !== "CAMPAIGN") pushWatch("flow_event_not_campaign");
      if (flow(input.rail_scores) < 65) pushBlock("flow_score_floor");
      if (rs(input.rail_scores) < 50) pushWatch("flow_rs_weak");
      break;
    }
    case "MEAN_REVERSION": {
      if (reversal(input.rail_scores) < 60) pushBlock("reversal_score_floor");
      if (positioning(input.rail_scores) < 50) pushWatch("reversal_no_positioning");
      notes.push("g1_relax_candidate");
      break;
    }
    case "GAMMA_BREAK": {
      if (positioning(input.rail_scores) < 55) pushBlock("gamma_positioning_floor");
      if (breakout(input.rail_scores) < 50) pushWatch("gamma_no_structure");
      break;
    }
    case "CATALYST_CONTINUATION": {
      const pillars = [
        (input.rail_scores.CATALYST ?? 0) >= 50,
        breakout(input.rail_scores) >= 55,
        flow(input.rail_scores) >= 55,
        (input.rail_scores.MOMENTUM ?? 0) >= 55,
      ].filter(Boolean).length;
      if (pillars < 2) pushBlock("catalyst_confluence");
      break;
    }
    case "FAILED_BREAKOUT": {
      if (reversal(input.rail_scores) < 55) pushBlock("failed_break_reversal_floor");
      if (input.structural_state === "TRIGGERED") pushWatch("failed_break_still_triggered");
      break;
    }
    case "VOL_EXPANSION": {
      if (input.structural_state !== "COILED" && input.structural_state !== "TRIGGERED") {
        pushWatch("vol_expansion_no_compression");
      }
      if ((input.rail_scores.VOL ?? 0) < 50) pushWatch("vol_rail_weak");
      break;
    }
    default:
      break;
  }

  if (input.et_minutes != null && input.et_minutes < 10 * 60 && input.archetype !== "MEAN_REVERSION") {
    pushWatch("pre_1000_et");
  }

  return { verdict, archetype: input.archetype, blocks, notes };
}
