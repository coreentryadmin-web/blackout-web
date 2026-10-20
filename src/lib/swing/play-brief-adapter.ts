// Adapter: transform SwingPlayBriefResult (BieAnswerEnvelope, UI-facing) into ProductRead<SwingPlayBriefSignal>
// for Largo consumption. The contract requires specific fields (as_of format, freshness, direction, evidence)
// that the UI envelope does not carry — this adapter supplies them without mutating the envelope.

import type { BieAnswerEnvelope, BieBias } from "@/lib/bie/answer-envelope";
import {
  canonicalTicker,
  productRead,
  type Confidence,
  type Direction,
  type ProductRead,
  type ProductSignal,
} from "@/lib/largo/contract/product-read";
import { etStampFromIso } from "@/lib/largo/temporal/bar-session-date";
import type { SwingPlayBriefResult } from "@/lib/swing/play-brief-types";

/** Swing play brief data for Largo consumption — the structured answer. */
export type SwingPlayBriefSignal = ProductSignal & {
  /** Session archetype + sub-lane for aggregation. */
  archetype?: string;
  sub_lane?: string;
  /** Entry premium in dollars. */
  entry_premium?: number;
  /** Peak premium (best unrealized MFE). */
  peak_premium?: number | null;
  /** Position management — entry/hold/trim/closed. */
  bucket?: string;
  /** Thesis strength as percentage (0-100). */
  thesis_strength_pct?: number | null;
  /** Grade label (A/B/C/unrated). */
  grade?: string;
  /** Thesis invalidation condition. */
  invalidation?: string | null;
  /** Raw narrative markdown for fuller context. */
  narrative?: string;
};

/**
 * Produce the "YYYY-MM-DD HH:mm ET" string Largo C1 requires for `as_of`.
 *
 * BUG THIS REPLACES (found live 2026-10-20, 100% of play-brief requests 503ing with
 * "Invalid time value"): the real `SwingPlayBriefResult.asOf` comes from
 * `play-brief-context.ts`'s `etStamp(nowMs)`, which already returns this exact ET-stamp display
 * format — never a raw ISO-8601 string. A prior version of this function assumed an ISO input and
 * called `new Date(isoString)` on it directly; fed an ET-stamp string, that produces an Invalid
 * Date, and `Intl.DateTimeFormat.formatToParts()` throws `RangeError: Invalid time value` on an
 * Invalid Date — on every single call, since the ISO-fallback branch in `play-brief-context.ts`
 * (`etStamp(nowMs) ?? new Date(nowMs).toISOString()`) is effectively dead code (`etStamp` only
 * returns null for a non-finite/non-positive timestamp, never for `Date.now()`).
 *
 * Reuses the shared `etStampFromIso` (src/lib/largo/temporal/bar-session-date.ts) instead of a
 * second, ad-hoc formatter: it already handles both shapes this field can actually carry — an
 * already-ET-stamped string passes through unchanged (`Date.parse` on "YYYY-MM-DD HH:mm ET"
 * fails, so it falls back to returning the input as-is, which is already correct), and a genuine
 * ISO string is parsed and reformatted into the same ET-stamp shape.
 */
function formatAsOfET(asOf: string): string {
  return etStampFromIso(asOf) ?? asOf;
}

/**
 * Extract direction from envelope bias field (Largo C5).
 */
function extractDirection(bias: BieBias): Direction {
  const directionMap: Record<BieBias, Direction> = {
    bullish: "bullish",
    bearish: "bearish",
    neutral: "neutral",
    mixed: "neutral", // Default mixed to neutral for Largo
  };
  return directionMap[bias] || "neutral";
}

/**
 * Extract specific numbers from the envelope as evidence strings (Largo C7).
 * Pulls from sections, confidence reasoning, and levels (not just prose interpretation).
 */
function extractEvidence(envelope: BieAnswerEnvelope): string[] {
  const evidence: string[] = [];

  // Headline + bias
  evidence.push(`${envelope.headline} (${envelope.bias})`);

  // Confidence reason if present
  if (envelope.confidence?.why) {
    evidence.push(`Confidence: ${envelope.confidence.why}`);
  }

  // Section titles (avoid full body prose — just the structured parts)
  for (const section of envelope.sections) {
    if (section.bias) {
      evidence.push(`${section.title}: ${section.bias}`);
    }
    if (section.confidence?.why) {
      evidence.push(`${section.title} confidence: ${section.confidence.why}`);
    }
  }

  // Levels (key prices)
  if (envelope.levels && envelope.levels.length > 0) {
    for (const level of envelope.levels) {
      evidence.push(`${level.label}: $${level.price.toFixed(2)}`);
    }
  }

  // Scenarios
  if (envelope.scenarios && envelope.scenarios.length > 0) {
    for (const scenario of envelope.scenarios) {
      evidence.push(`${scenario.kind.toUpperCase()}: ${scenario.thesis}`);
    }
  }

  // Invalidation
  if (envelope.invalidation) {
    evidence.push(`Invalidation: ${envelope.invalidation}`);
  }

  // If we have no evidence yet, fall back to bias + headline
  if (evidence.length === 0) {
    evidence.push(`${envelope.headline} (${envelope.bias})`);
  }

  return evidence;
}

/**
 * Adapt a SwingPlayBriefResult (composed BieAnswerEnvelope) into a ProductRead<SwingPlayBriefSignal>
 * conforming to Largo contract requirements.
 */
export function adaptSwingBriefToLargo(result: SwingPlayBriefResult): ProductRead<SwingPlayBriefSignal> {
  const { envelope, asOf, ticker, ticker_class, playId } = result;
  const canonicalTick = canonicalTicker(ticker);

  const signal: SwingPlayBriefSignal = {
    ticker: canonicalTick,
    // C4 IDENTITY: reuse the brief's own classification (composeSwingPlayBrief derives it from
    // the shared largo/core/entities.ts canonicalTicker) rather than a second, independently
    // hardcoded guess — a prior version of this adapter kept its own 6-ETF allowlist here, which
    // disagreed with the native field (e.g. SQQQ) inside the very same response. One brief, one
    // classification.
    ticker_class,
    direction: extractDirection(envelope.bias),
    evidence: extractEvidence(envelope),
    native: {
      playId,
      engine: result.engine,
      briefContentKey: result.briefContentKey,
    },
    narrative: envelope.markdown,
  };

  // No confidence here — swing play-brief is deterministic (no model uncertainty to calibrate)
  // The confidence field is intentionally omitted per C6 ("OMIT this entirely when a product cannot calibrate")

  return productRead(
    {
      product: "swing",
      as_of: formatAsOfET(asOf),
      freshness: "cached", // Deterministic service, no live upstream
      age_seconds: null, // Freshness is session-anchored, not wall-clock-age
      source: "computed", // No external provider — pure deterministic logic
      cohort: "all_swing_plays", // Swing plays are one cohort for this product
    },
    signal
  );
}
