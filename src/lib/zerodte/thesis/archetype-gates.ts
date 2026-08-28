import type { ArchetypeGateResult, ArchetypeGateVerdict, RailScoreMap, StructuralState, TradeArchetype } from "./types";

export type ArchetypeGateInput = {
  archetype: TradeArchetype;
  rail_scores: RailScoreMap;
  structural_state: StructuralState;
  flow_class?: "EVENT" | "CAMPAIGN" | null;
  et_minutes?: number;
};

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
      // No RS floor here — scoreRsRail (rails/rs.ts) only ever returns a hit once its OWN
      // internal score already clears 55, so a "fired" RS score can never read below 55. A floor
      // of `rail_scores.RS < 55` is therefore identical to "RS never fired" — and RS never
      // fires in production: legacyBridgeExtrasFromSetup/thesisEvidenceToLegacyExtras never
      // populate the session-% inputs the rail needs (stock_session_pct/qqq_session_pct/
      // sector_session_pct/d10_alpha). The floor blocked 100% of MOMENTUM_CONTINUATION setups
      // since it shipped — confirmed live 2026-08-28 (INTC 92P, tier REJECT on this exact gate,
      // later ran +275%). MOMENTUM's own absolute floor below is the real quality gate here.
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
      // Same RS-absence tautology as MOMENTUM_CONTINUATION above (see comment there) — RS never
      // fires in production, so this always demoted an otherwise-A-tier FLOW_FOLLOWING setup to
      // WATCH via resolveThesisRankTier's `verdict === "PASS"` requirement. Removed rather than
      // gated: there is currently no way to tell "RS fetched and weak" from "RS never fetched".
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
      // No separate `failed_break_reversal_floor < 55` check here — scoreReversalRail
      // (rails/reversal.ts) starts at a base of 42 and only returns a hit once boosts push it
      // to >=58, so a fired REVERSAL score is always >=58, always above 55. The check was dead
      // code: it could never block anything the rail itself didn't already require. Removed
      // rather than left in place implying protection it never provided.
      if (input.structural_state === "TRIGGERED") pushWatch("failed_break_still_triggered");
      break;
    }
    case "VOL_EXPANSION": {
      if (input.structural_state !== "COILED" && input.structural_state !== "TRIGGERED") {
        pushWatch("vol_expansion_no_compression");
      }
      // No separate `vol_rail_weak < 50` note here — scoreVolRail (rails/vol.ts) starts at a
      // base of 45 and only returns a hit once boosts push it to >=52, so a fired VOL score is
      // always >=52, always above 50. Same dead-code pattern as failed_break_reversal_floor
      // above — removed rather than left implying a check that never actually ran.
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
