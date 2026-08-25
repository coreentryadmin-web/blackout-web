import type { EnrichedZeroDteSetup } from "../board";
import { classifyTradeArchetype, scoreForArchetype } from "./archetype";
import { evaluateArchetypeGates } from "./archetype-gates";
import { pickBestExpression, type ContractEngineInput } from "./contract-engine";
import {
  buildRailScoreMap,
  countSystemsAligned,
  mergeRailHitsByTicker,
  resolveMergedDirection,
} from "./merge";
import { railHitsFromLegacySetup, type LegacyBridgeExtras } from "./rails/legacy-bridge";
import type { MergedThesis, RailHit, ThesisPipelineResult } from "./types";

export function buildMergedThesisFromHits(ticker: string, hits: RailHit[]): MergedThesis | null {
  const direction = resolveMergedDirection(hits);
  if (!direction) return null;

  const aligned = hits.filter((h) => h.direction === direction);
  const disagreeing_rails = hits
    .filter((h) => h.direction !== direction)
    .map((h) => ({
      rail: h.rail,
      direction: h.direction,
      score: h.score,
      summary: h.summary,
    }));

  const { rail_scores, rails_fired, summaries, structural_state, trigger_price } =
    buildRailScoreMap(aligned);

  const match = classifyTradeArchetype(rail_scores, structural_state ?? null);
  const archetype_score = scoreForArchetype(match.archetype, rail_scores, structural_state ?? null);

  return {
    ticker: ticker.toUpperCase(),
    direction,
    rail_scores,
    rails_fired,
    systems_aligned: countSystemsAligned(rail_scores),
    trade_archetype: match.archetype,
    archetype_score: Math.max(archetype_score, match.confidence),
    structural_state: structural_state ?? null,
    trigger_price,
    summaries,
    disagreeing_rails,
  };
}

export function runThesisPipelineForSetup(
  setup: EnrichedZeroDteSetup,
  extras: LegacyBridgeExtras = {},
  contractInput?: Omit<ContractEngineInput, "thesis">
): ThesisPipelineResult {
  const hits = railHitsFromLegacySetup(setup, extras);
  const thesis =
    buildMergedThesisFromHits(setup.ticker, hits) ??
    ({
      ticker: setup.ticker,
      direction: setup.direction,
      rail_scores: {},
      rails_fired: [],
      systems_aligned: 0,
      trade_archetype: "MOMENTUM_CONTINUATION",
      archetype_score: setup.score,
      structural_state: null,
      trigger_price: null,
      summaries: {},
      disagreeing_rails: [],
    } satisfies MergedThesis);

  const flowHit = hits.find((h) => h.rail === "FLOW");
  const archetype_gates = evaluateArchetypeGates({
    archetype: thesis.trade_archetype,
    rail_scores: thesis.rail_scores,
    structural_state: thesis.structural_state,
    flow_class: flowHit?.flow_class ?? null,
  });

  let expression = null;
  if (contractInput && contractInput.chain.length > 0) {
    expression = pickBestExpression({ thesis, ...contractInput });
  }

  let rank_tier: ThesisPipelineResult["rank_tier"] = "WATCH";
  if (archetype_gates.verdict === "BLOCK") rank_tier = "REJECT";
  else if (thesis.systems_aligned >= 4 && thesis.archetype_score >= 85) rank_tier = "A+";
  else if (thesis.archetype_score >= 75 && archetype_gates.verdict === "PASS") rank_tier = "A";
  else if (thesis.archetype_score >= 65) rank_tier = "B";

  return { thesis, archetype_gates, expression, rank_tier };
}

/** Merge all setups in a scan pass — one MergedThesis per ticker. */
export function mergeScanPassTheses(
  setups: EnrichedZeroDteSetup[],
  extrasByTicker: Record<string, LegacyBridgeExtras> = {}
): Map<string, MergedThesis> {
  const allHits: RailHit[] = [];
  for (const s of setups) {
    allHits.push(...railHitsFromLegacySetup(s, extrasByTicker[s.ticker] ?? {}));
  }
  const byTicker = mergeRailHitsByTicker(allHits);
  const out = new Map<string, MergedThesis>();
  for (const [ticker, hits] of byTicker) {
    const merged = buildMergedThesisFromHits(ticker, hits);
    if (merged) out.set(ticker, merged);
  }
  return out;
}
