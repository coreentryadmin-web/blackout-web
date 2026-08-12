import { extractLargoSegments } from "@/features/largo/blocks/extract";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { deriveMarketState, type MarketState } from "@/lib/largo/core/market-state";

/** Whether the answer markdown includes a model-authored comparison block. */
export function hasComparisonBlock(markdown: string | null | undefined): boolean {
  return /"type"\s*:\s*"comparison"/i.test(String(markdown ?? ""));
}

function hasAnyBlock(markdown: string | null | undefined): boolean {
  return extractLargoSegments(String(markdown ?? "")).some((s) => s.kind === "block");
}

/**
 * Coherence rules — what to show so the card never argues with itself.
 * Pure: no IO, no throw.
 */
export type DeskReadVisibility = {
  state: MarketState;
  showStateChip: boolean;
  showActionChip: boolean;
  showSystemReads: boolean;
  showFallbackSignals: boolean;
  showLevelSignals: boolean;
  showInlineBlocks: boolean;
  showConfidenceWhy: boolean;
};

export function deskReadVisibility(
  envelope: BieAnswerEnvelope,
  markdownSource: string | null | undefined
): DeskReadVisibility {
  const state = deriveMarketState(envelope.headline ?? "");
  const trade = envelope.tradeDecision;
  const comparison = hasComparisonBlock(markdownSource) || hasAnyBlock(markdownSource);
  const fallbackSignals = (trade?.signalRows.length ?? 0) > 0;
  const levelSignals = (envelope.levels?.length ?? 0) > 0;

  const confidenceBody = envelope.sections?.find((s) => s.title.toLowerCase() === "confidence")?.body?.trim();
  const confidenceWhy = envelope.confidence?.why?.trim();
  const confidenceDup =
    Boolean(confidenceWhy && confidenceBody) &&
    confidenceWhy!.replace(/\s+/g, " ") === confidenceBody!.replace(/\s+/g, " ");

  return {
    state,
    showStateChip: state !== "no-read",
    showActionChip: Boolean(trade?.actionLabel) || state !== "no-read",
    showSystemReads: Boolean(envelope.systemReads?.reads.length) && !comparison && !fallbackSignals,
    showFallbackSignals: fallbackSignals && !comparison,
    showLevelSignals: levelSignals && !comparison && !fallbackSignals,
    showInlineBlocks: comparison || hasAnyBlock(markdownSource),
    showConfidenceWhy: Boolean(confidenceWhy) && !confidenceDup,
  };
}
