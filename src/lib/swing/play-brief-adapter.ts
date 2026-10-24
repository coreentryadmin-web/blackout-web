// Adapter: transform SwingPlayBriefResult (BieAnswerEnvelope, UI-facing) into ProductRead<SwingPlayBriefSignal>
// for Largo consumption. The contract requires specific fields (as_of format, freshness, direction, evidence)
// that the UI envelope does not carry — this adapter supplies them without mutating the envelope.

import type { BieAnswerEnvelope, BieBias } from "@/lib/bie/answer-envelope";
import {
  canonicalTicker,
  productRead,
  type Confidence,
  type Direction,
  type Freshness,
  type ProductRead,
  type ProductSignal,
} from "@/lib/largo/contract/product-read";
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
 * Extract specific numbers from the envelope as evidence strings (Largo C7 — "the specific
 * numbers behind the claim, not a restatement of it", `ProductSignal.evidence`'s own doc comment).
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-22): this used to never read `envelope.evidence`
 * at all — the REAL, honesty-taxonomy-tagged evidence array `evidenceFromContext` (play-brief.ts)
 * builds for exactly this purpose (dealer-posture strike distances, HELIX flow $ premium/print
 * counts, earnings dates, peer lists — literal numbers, per that function's own C7 header) — and
 * instead manufactured its OWN list out of restatements the C7 doc comment explicitly disclaims:
 * the headline+bias repeated verbatim, each section's bare bias word, and confidence prose. A
 * model reading the structured `evidence` field saw zero of the brief's actual sourced numbers and
 * only a paraphrase of the claim the evidence is supposed to back up.
 *
 * Fix: lead with the real `envelope.evidence[]` text (every kind — fact/calc entries carry the
 * numbers C7 wants; inference/scenario entries are still genuine sourced evidence, not invented
 * padding). Levels/scenarios/invalidation stay — they carry real price numbers too — but the pure
 * restatement bits (headline+bias, section bias words, confidence prose) are dropped; they were
 * never numbers, and headline+bias in particular is the literal claim C7 says evidence must not
 * just restate. The final bare fallback is kept only for the honest-emptiness case (an envelope
 * with no evidence at all) so the contract's non-empty-array requirement is never violated by
 * fabricating a number that was never computed.
 */
function extractEvidence(envelope: BieAnswerEnvelope): string[] {
  const evidence: string[] = [];

  // The real, sourced evidence this envelope was actually built from — the specific numbers.
  for (const item of envelope.evidence) {
    evidence.push(item.text);
  }

  // Levels (key prices) — numeric, not a restatement.
  if (envelope.levels && envelope.levels.length > 0) {
    for (const level of envelope.levels) {
      evidence.push(`${level.label}: $${level.price.toFixed(2)}`);
    }
  }

  // Scenarios — bull/base/bear theses carry their own numbers (targets), not a bare restatement.
  if (envelope.scenarios && envelope.scenarios.length > 0) {
    for (const scenario of envelope.scenarios) {
      evidence.push(`${scenario.kind.toUpperCase()}: ${scenario.thesis}`);
    }
  }

  // Invalidation — the specific go-flat condition/price, not a restatement of the claim.
  if (envelope.invalidation) {
    evidence.push(`Invalidation: ${envelope.invalidation}`);
  }

  // Only when NOTHING above produced a single real item: fall back to bias + headline so the
  // contract's "non-empty array" requirement is satisfied honestly rather than fabricated.
  if (evidence.length === 0) {
    evidence.push(`${envelope.headline} (${envelope.bias})`);
  }

  return evidence;
}

/**
 * Largo C2 freshness bucket from the worst known per-source age (`SwingPlayBriefResult.dataAgeMs`
 * — see `worstKnownSwingDataAgeMs`'s header in play-brief-intel.ts for where that number comes
 * from). Thresholds reuse this desk's own EXISTING staleness bounds rather than inventing new
 * ones: 120s is Vector/GEX's own stale cutoff (`GEX_MATRIX_STALE_MS`, play-brief-absence.ts —
 * Vector shares the identical bound), 1080s is the option mark's own cadence-aware stale cutoff
 * (`SWING_OPTION_MARK_STALE_MS`, entry-enterability.ts, sized for its 15-minute refresh cycle).
 * Below the tighter bound reads "live"; at/past the looser bound reads "stale"; the band between
 * (a source that has outlived Vector/GEX's tighter cutoff but is still within the option mark's
 * normal on-schedule window) reads "delayed" — the same three-bucket shape `helix-contract.ts`'s
 * sibling `tapeFreshness` already uses for an analogous "age -> Freshness" mapping elsewhere in the
 * Largo-contract surface.
 */
function freshnessFromAgeSeconds(ageSeconds: number): Freshness {
  if (ageSeconds < 120) return "live";
  if (ageSeconds < 1080) return "delayed";
  return "stale";
}

/**
 * Adapt a SwingPlayBriefResult (composed BieAnswerEnvelope) into a ProductRead<SwingPlayBriefSignal>
 * conforming to Largo contract requirements.
 */
export function adaptSwingBriefToLargo(result: SwingPlayBriefResult): ProductRead<SwingPlayBriefSignal> {
  const { envelope, asOf, ticker, ticker_class, playId, dataAgeMs } = result;
  const canonicalTick = canonicalTicker(ticker);
  // BUG FIX (Largo C2, 2026-10-21, Ask Largo standing mandate — live 6-brief repro CRWV:61/
  // CRWV:63/GOOG:59/NVDA:62/TSLA:60/AMZN:48, spanning OPEN/CLOSED/ROLLED): `freshness`/`age_seconds`
  // below used to be hardcoded ("cached"/null) on every response, regardless of the real,
  // already-known per-source staleness this same compose path computes elsewhere (Vector/GEX/
  // option-mark ages — the SAME numbers the brief's own "Data freshness" prose section discloses,
  // e.g. "Vector data **8642s** old"). A model reading the structured contract field saw no age at
  // all for an answer whose own prose, a few sections below it in the SAME response, discloses a
  // multi-hour-stale read. `age_seconds` now surfaces the worst (oldest / most load-bearing) known
  // age; `freshness` is DERIVED from it, never asserted independently of it. Falls back to the
  // original honest-omission "cached"/null ONLY when no per-source age is genuinely knowable this
  // cycle (e.g. a CLOSED play with no markAsOf) — never fabricated (Largo C6 applied to C2).
  const age_seconds = dataAgeMs != null ? Math.max(0, Math.round(dataAgeMs / 1000)) : null;
  const freshness: Freshness = age_seconds != null ? freshnessFromAgeSeconds(age_seconds) : "cached";

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
      // BUG FIX (production 2026-10-20, every swing play-brief 503ing with "Invalid time
      // value"): `asOf` here is `SwingPlayBriefResult.asOf`, which is always
      // `SwingPlayBriefContext.asOf` (play-brief.ts), which is always `etStamp(nowMs)`
      // (play-brief-context.ts) — ALREADY the exact "YYYY-MM-DD HH:mm ET" shape Largo C1
      // requires. A prior version of this adapter re-parsed it with `new Date(asOf)` as if it
      // were a raw ISO instant; `new Date("2026-10-20 00:41 ET")` is an Invalid Date, and
      // `Intl.DateTimeFormat.formatToParts()` on an Invalid Date throws `RangeError: Invalid
      // time value` — uncaught by every caller, every ticker, every status, since `asOf` is
      // computed once per request and is never a raw ISO string in practice. Pass it through
      // verbatim instead of re-formatting an already-formatted stamp.
      as_of: asOf,
      // Largo C2 — see the BUG FIX comment above (and worstKnownSwingDataAgeMs's header,
      // play-brief-intel.ts) for why these are computed from the brief's own known per-source
      // ages rather than hardcoded. Falls back to "cached"/null only when none is knowable.
      freshness,
      age_seconds,
      source: "computed", // No external provider — pure deterministic logic
      cohort: "all_swing_plays", // Swing plays are one cohort for this product
    },
    signal
  );
}
