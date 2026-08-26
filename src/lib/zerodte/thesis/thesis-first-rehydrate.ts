/**
 * Rebuild a ThesisPipelineResult from the compact entry_context.thesis_first blob
 * (thesisFirstEntryContext in scan-shadow.ts). Closed ledger rows carry the compact
 * shape, not the live pipeline object — the Command deck needs this to render desk evidence.
 */
import type { DeskEvidenceLine } from "./desk-evidence-lines";
import type {
  ArchetypeGateResult,
  ArchetypeGateVerdict,
  DisagreeingRail,
  ExpressionDecision,
  MergedThesis,
  StructuralState,
  ThesisPipelineResult,
  ThesisRail,
  ThesisRankTier,
  TradeArchetype,
} from "./types";

function isFullPipeline(v: Record<string, unknown>): v is Record<string, unknown> & { thesis: MergedThesis } {
  return v.thesis != null && typeof v.thesis === "object";
}

function asTradeArchetype(v: unknown): TradeArchetype | null {
  return typeof v === "string" ? (v as TradeArchetype) : null;
}

function asRankTier(v: unknown): ThesisRankTier | null {
  return typeof v === "string" ? (v as ThesisRankTier) : null;
}

function asGateVerdict(v: unknown): ArchetypeGateVerdict {
  if (v === "PASS" || v === "WATCH" || v === "BLOCK") return v;
  return "PASS";
}

function expressionFromBlob(blob: Record<string, unknown>): ExpressionDecision | null {
  const horizon = blob.expression_horizon;
  if (horizon !== "ZERO_DTE" && horizon !== "SWING" && horizon !== "BANGER" && horizon !== "CONDOR" && horizon !== "NONE") {
    return null;
  }
  const strike = typeof blob.expression_strike === "number" ? blob.expression_strike : null;
  const expiry = typeof blob.expression_expiry === "string" ? blob.expression_expiry : null;
  if (strike == null || !expiry) return null;
  const dte = typeof blob.expression_dte === "number" ? blob.expression_dte : 0;
  const side: "call" | "put" = blob.expression_side === "put" ? "put" : "call";
  return {
    horizon,
    dte_target: dte,
    contract: {
      expiry,
      strike,
      dte,
      side,
      bid: null,
      ask: null,
      oi: 0,
      score: typeof blob.expression_score === "number" ? blob.expression_score : 0,
      spread_pct: null,
      reasons: [],
    },
    contract_score: typeof blob.expression_score === "number" ? blob.expression_score : 0,
    alternatives: [],
    vol_rationale: null,
    rationale: typeof blob.expression_rationale === "string" ? blob.expression_rationale : "",
  };
}

/** Compact entry_context blob → terminal ThesisRankCard input. Returns null when unrecoverable. */
export function thesisFirstFromEntryContext(
  raw: Record<string, unknown> | null | undefined,
  ticker: string,
  direction: "long" | "short",
): ThesisPipelineResult | null {
  if (!raw || typeof raw !== "object") return null;

  if (isFullPipeline(raw)) {
    const full = raw as unknown as ThesisPipelineResult;
    if (full.thesis?.ticker && full.rank_tier) return full;
  }

  const tradeArchetype = asTradeArchetype(raw.trade_archetype);
  const rankTier = asRankTier(raw.rank_tier);
  if (!tradeArchetype || !rankTier) return null;

  const thesis: MergedThesis = {
    ticker: ticker.toUpperCase(),
    direction,
    rail_scores: (raw.rail_scores as MergedThesis["rail_scores"]) ?? {},
    rails_fired: Array.isArray(raw.rails_fired) ? (raw.rails_fired as ThesisRail[]) : [],
    systems_aligned: typeof raw.systems_aligned === "number" ? raw.systems_aligned : 0,
    trade_archetype: tradeArchetype,
    archetype_score: typeof raw.archetype_score === "number" ? raw.archetype_score : 0,
    structural_state: (raw.structural_state as StructuralState) ?? null,
    trigger_price: typeof raw.trigger_price === "number" ? raw.trigger_price : null,
    summaries: (raw.summaries as MergedThesis["summaries"]) ?? {},
    disagreeing_rails: Array.isArray(raw.disagreeing_rails)
      ? (raw.disagreeing_rails as DisagreeingRail[])
      : [],
  };

  const archetype_gates: ArchetypeGateResult = {
    verdict: asGateVerdict(raw.archetype_gate),
    archetype: tradeArchetype,
    blocks: Array.isArray(raw.archetype_blocks) ? (raw.archetype_blocks as string[]) : [],
    notes: [],
  };

  const desk_evidence = Array.isArray(raw.desk_evidence)
    ? (raw.desk_evidence as DeskEvidenceLine[])
    : undefined;

  return {
    thesis,
    archetype_gates,
    expression: expressionFromBlob(raw),
    rank_tier: rankTier,
    desk_evidence,
  };
}
