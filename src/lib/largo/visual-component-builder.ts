/**
 * VISUAL COMPONENT BUILDER — transforms structured Phase 1 data into Blackout JSON components.
 *
 * This bridges Phase 1 (data architecture: consensus extraction, desk-read decision)
 * and the rendering layer. Components are generated from actual market data, not templates.
 *
 * Component types available:
 * - comparison: multi-source signal alignment (the consensus matrix)
 * - levels: price levels with support/resistance/target kind
 * - header: verdict banner with decision emoji + confidence
 * - evidence: bullish vs bearish signals side-by-side
 * - risk: invalidation + stop conditions
 * - callout: one line that matters now (desk read decision)
 */

import type { ConsensusMatrix, SystemDirectionalRead } from "@/lib/largo/consensus-read-extract";
import type { DeskReadDecision } from "@/lib/largo/desk-read-decision";

export type BlackoutComponentType =
  | "header"
  | "metrics"
  | "comparison"
  | "table"
  | "ranked"
  | "levels"
  | "evidence"
  | "timeline"
  | "contracts"
  | "pnl"
  | "callout"
  | "risk";

export type ToneType = "bullish" | "bearish" | "neutral" | "warning" | "info";

export interface BlackoutComponent {
  type: BlackoutComponentType;
  title?: string;
  subtitle?: string;
  [key: string]: any;
}

/**
 * Build a consensus comparison component from multi-system reads.
 * Shows which systems agree, which conflict, and their strength.
 * Belongs under **Facts** in the answer contract.
 */
export function buildConsensusComponent(consensus: ConsensusMatrix): BlackoutComponent {
  const rows = consensus.reads.map((read) => ({
    label: read.system.replace(/_/g, " ").toLowerCase(),
    reading: `${read.direction === "bullish" ? "↑" : read.direction === "bearish" ? "↓" : "→"} ${read.basis}`,
    tone: read.direction === "bullish" ? "bullish" : read.direction === "bearish" ? "bearish" : "neutral",
    note: `strength ${read.strength}/10`,
  }));

  const conflictNote =
    consensus.contradictions.length > 0
      ? `${consensus.contradictions.length} conflict${consensus.contradictions.length !== 1 ? "s" : ""}: ${consensus.contradictions
          .map((c) => c.why)
          .join("; ")}`
      : undefined;

  return {
    type: "comparison",
    title: "Multi-system consensus",
    subtitle: conflictNote,
    rows,
  };
}

/**
 * Build a levels component from extracted price support/resistance.
 * Shows floor (support), gate (pivot/entry), king (resistance/target).
 * Belongs under **Facts** in the answer contract.
 */
export function buildLevelsComponent(
  levels: { floor: number; gate: number; king: number },
  spot?: number
): BlackoutComponent {
  const items = [];

  if (levels.floor) {
    items.push({
      label: "Floor (support)",
      price: levels.floor,
      kind: "support",
      note: spot ? `${((spot - levels.floor) / levels.floor) * 100 > 0 ? "+" : ""}${(((spot - levels.floor) / levels.floor) * 100).toFixed(1)}% from spot` : undefined,
    });
  }

  if (levels.gate) {
    items.push({
      label: "Gate (entry level)",
      price: levels.gate,
      kind: "pivot",
    });
  }

  if (levels.king) {
    items.push({
      label: "King (resistance/target)",
      price: levels.king,
      kind: "resistance",
      note: spot ? `${((levels.king - spot) / spot) * 100 > 0 ? "+" : ""}${(((levels.king - spot) / spot) * 100).toFixed(1)}% from spot` : undefined,
    });
  }

  return {
    type: "levels",
    title: "Key price levels (SPX)",
    spot,
    items,
  };
}

/**
 * Build a trade decision component from desk-read decision.
 * Shows state (PLAY/WAIT/NO_TRADE), thesis, trigger, invalidation.
 * Use in a dedicated **Trade Decision** section or under **Risk** for invalidation.
 */
export function buildTradeDecisionComponent(decision: DeskReadDecision): BlackoutComponent {
  const glyph = decision.state === "PLAY" ? "🟢" : decision.state === "WAIT" ? "🟡" : "🔴";
  const tone: ToneType = decision.state === "PLAY" ? "bullish" : decision.state === "NO_TRADE" ? "bearish" : "warning";

  const title = `${glyph} ${decision.ticker} — ${decision.state}`;
  const subtitle = decision.thesis;

  const items = [];

  items.push({
    signal: "Thesis",
    read: decision.thesis,
    basis: "market conditions",
  });

  if (decision.trigger) {
    items.push({
      signal: "Trigger",
      read: decision.trigger,
      basis: decision.state === "WAIT" ? "condition to confirm" : "entry signal",
    });
  }

  if (decision.invalidation) {
    items.push({
      signal: "Invalidation",
      read: decision.invalidation,
      basis: "thesis breaks if",
    });
  }

  items.push({
    signal: "Confidence",
    read: `${Math.round(decision.confidence * 100)}%`,
    basis: decision.state === "NO_TRADE" ? "missing evidence" : decision.state === "WAIT" ? "waiting for clarity" : "strong consensus",
  });

  return {
    type: "comparison",
    title,
    subtitle,
    rows: items.map((item) => ({
      label: item.signal,
      reading: item.read,
      tone,
      note: item.basis,
    })),
  };
}

/**
 * Build an evidence component showing bullish vs bearish signals.
 * Shows which systems or factors support each direction.
 * Belongs under **Interpretation** in the answer contract.
 */
export function buildEvidenceComponent(consensus: ConsensusMatrix): BlackoutComponent | null {
  const bullish = consensus.reads.filter((r) => r.direction === "bullish").map((r) => ({
    label: r.system.replace(/_/g, " ").toLowerCase(),
    value: `${r.basis} (${r.strength}/10)`,
  }));

  const bearish = consensus.reads.filter((r) => r.direction === "bearish").map((r) => ({
    label: r.system.replace(/_/g, " ").toLowerCase(),
    value: `${r.basis} (${r.strength}/10)`,
  }));

  const neutral = consensus.reads.filter((r) => r.direction === "neutral" || r.direction === "mixed").map((r) => ({
    label: r.system.replace(/_/g, " ").toLowerCase(),
    value: `${r.basis} (${r.strength}/10)`,
  }));

  if (bullish.length === 0 && bearish.length === 0) return null;

  return {
    type: "evidence",
    title: "Signal breakdown",
    bull: bullish.length > 0 ? bullish : undefined,
    bear: bearish.length > 0 ? bearish : undefined,
    neutral: neutral.length > 0 ? neutral : undefined,
  };
}

/**
 * Build a risk/invalidation component from desk-read decision.
 * Shows what breaks the thesis and what the consequences are.
 * Belongs under **Risk** in the answer contract.
 */
export function buildRiskComponent(decision: DeskReadDecision): BlackoutComponent {
  const items = [];

  if (decision.invalidation) {
    items.push({
      signal: decision.invalidation,
      consequence: "thesis no longer valid",
    });
  }

  if (decision.missingEvidence && decision.missingEvidence.length > 0) {
    items.push({
      signal: "Missing evidence",
      consequence: decision.missingEvidence.join("; "),
    });
  }

  return {
    type: "risk",
    title: decision.state === "PLAY" ? "What breaks this play" : "What strengthens this read",
    items: items.map((item) => ({
      label: item.signal,
      note: item.consequence,
    })),
    invalidation: decision.invalidation,
  };
}

/**
 * Build a header/callout component for quick verdict.
 * The one-line that matters: the decision state + headline.
 * Place at the TOP of an answer for TRADE_INTENT questions.
 */
export function buildDecisionCallout(decision: DeskReadDecision): BlackoutComponent {
  const glyph = decision.state === "PLAY" ? "🟢" : decision.state === "WAIT" ? "🟡" : "🔴";
  const actionLabel = decision.state === "PLAY" ? "ENTER" : decision.state === "WAIT" ? "WAIT FOR TRIGGER" : "STAND ASIDE";

  return {
    type: "callout",
    title: `${glyph} ${actionLabel}`,
    body: `${decision.thesis}. Confidence: ${Math.round(decision.confidence * 100)}%`,
    tone: decision.state === "PLAY" ? "bullish" : decision.state === "NO_TRADE" ? "bearish" : "warning",
  };
}

/**
 * Build a header component showing overall market read.
 * Use for MARKET_READ or COMPARISON intent questions.
 */
export function buildConsensusHeader(consensus: ConsensusMatrix, title: string): BlackoutComponent {
  const { verdict, direction, averageStrength } = consensus.agreement;

  return {
    type: "header",
    title,
    subtitle: `${direction?.toUpperCase() || "CONFLICTED"} — ${consensus.agreement.voting} systems consulted`,
    tone:
      direction === "bullish" ? "bullish" : direction === "bearish" ? "bearish" : verdict === "conflicted" ? "warning" : "neutral",
    badge: `${verdict}`,
    confidence: {
      level: averageStrength >= 8 ? "high" : averageStrength >= 5 ? "moderate" : "low",
      pct: averageStrength,
      why: `${consensus.agreement.bullish} bullish, ${consensus.agreement.bearish} bearish, ${consensus.agreement.neutral} neutral`,
    },
  };
}
