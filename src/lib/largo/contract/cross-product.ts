// CROSS-PRODUCT JOIN — how Largo represents several products' readings of the same thing.
//
// This is the integration layer's core semantic. Five product lanes each report their own view
// (`ProductSignal`, see product-read.ts). This module decides what Largo is allowed to say when
// those views are combined — and, more importantly, what it is NOT allowed to hide.
//
// THREE DECISIONS, each chosen against a more obvious alternative:
//
// 1. A LONE DISSENTER IS NOT NOISE. The obvious design is majority vote: four products bullish,
//    one bearish, answer "bullish". That deletes the single most valuable thing on the desk. If
//    Helix reads the tape bullish while Vector's differential says the regime just flipped, the
//    disagreement IS the finding — it is why a member would look twice before sizing up. So any
//    dissent produces `split`, and BOTH camps travel with their evidence.
//
// 2. DO NOT WEIGHT BY CONFIDENCE. Weighting is statistically tempting and structurally corrupt
//    here: the contract tells a product to OMIT confidence when it cannot calibrate. Weighting
//    would therefore systematically down-rank the honest lanes and up-rank whichever lane was most
//    willing to invent a number. Confidence is REPORTED, never multiplied by. A product that says
//    "I do not know how sure I am" must not lose its vote to one that guessed 0.9.
//
// 3. ABSENCE IS PART OF THE ANSWER. "Five products agree" and "the two that answered agree" are
//    different claims. Every product that did not report appears in `missing` with its reason, so
//    a thin consensus can never present itself as a broad one.

import type { Direction, ProductId, ProductSignal } from "./product-read";

/**
 * `aligned` — every reporting product points the same way.
 * `split`   — at least one product dissents. Not an error; usually the most useful state.
 * `insufficient` — fewer than two products reported, so there is nothing to cross-check.
 */
export type ConsensusVerdict = "aligned" | "split" | "insufficient";

export type Camp = {
  direction: Direction;
  products: ProductId[];
  /** Pooled evidence from every product in this camp — the numbers, not the claim. */
  evidence: string[];
};

export type MissingProduct = {
  product: ProductId;
  /** Why it did not report. Never blank — see decision 3. */
  reason: string;
};

export type CrossProductRead = {
  ticker: string;
  verdict: ConsensusVerdict;
  /** The agreed direction, or null when split or insufficient. Never a majority guess. */
  direction: Direction | null;
  /** Camps, largest first. One camp when aligned; two or three when split. */
  camps: Camp[];
  reporting: ProductId[];
  missing: MissingProduct[];
  /**
   * Plain-language statement of the split for the model to relay. Absent when aligned.
   * Describes WHAT disagrees, never resolves it — resolution is the member's call.
   */
  disagreement?: string;
};

export type ProductContribution = {
  product: ProductId;
  /** The product's signal, or null when it could not report. */
  signal: ProductSignal | null;
  /** Required when `signal` is null. */
  missingReason?: string;
};

/**
 * Join several products' readings of one ticker.
 *
 * Pure and total: every input shape produces a well-formed read. A contribution with a null signal
 * and no reason still appears in `missing` (with an explicit placeholder) rather than vanishing —
 * a product silently dropped from the denominator is the failure this whole module guards against.
 */
export function joinProductSignals(
  ticker: string,
  contributions: readonly ProductContribution[]
): CrossProductRead {
  const reporting: ProductId[] = [];
  const missing: MissingProduct[] = [];
  const byDirection = new Map<Direction, { products: ProductId[]; evidence: string[] }>();

  for (const c of contributions) {
    if (!c.signal) {
      missing.push({
        product: c.product,
        // A blank reason would let an unexplained absence read as a considered one.
        reason: c.missingReason || "did not report and gave no reason",
      });
      continue;
    }
    reporting.push(c.product);
    const camp = byDirection.get(c.signal.direction) ?? { products: [], evidence: [] };
    camp.products.push(c.product);
    // Attribute each piece of evidence so a member can tell WHICH product measured what.
    for (const e of c.signal.evidence) camp.evidence.push(`${c.product}: ${e}`);
    byDirection.set(c.signal.direction, camp);
  }

  const camps: Camp[] = [...byDirection.entries()]
    .map(([direction, v]) => ({ direction, products: v.products, evidence: v.evidence }))
    .sort((a, b) => b.products.length - a.products.length);

  if (reporting.length < 2) {
    return {
      ticker,
      verdict: "insufficient",
      direction: null,
      camps,
      reporting,
      missing,
      // Deliberately no `disagreement`: one voice cannot disagree with anything, and saying
      // "aligned" off a single product would manufacture consensus out of a sample of one.
    };
  }

  if (camps.length === 1) {
    return { ticker, verdict: "aligned", direction: camps[0].direction, camps, reporting, missing };
  }

  return {
    ticker,
    verdict: "split",
    direction: null,
    camps,
    reporting,
    missing,
    disagreement: describeSplit(ticker, camps),
  };
}

/** One sentence naming who reads it which way. States the split; never resolves it. */
function describeSplit(ticker: string, camps: readonly Camp[]): string {
  const sides = camps
    .map((c) => `${c.products.join(" + ")} read ${ticker} ${c.direction}`)
    .join("; ");
  return `${sides}. This is a genuine disagreement between products, not a data error — say so rather than picking a side.`;
}

/**
 * How complete a cross-product read is: "3/5 products reporting".
 *
 * Exposed separately because the model must be able to state it. A four-product consensus and a
 * two-product consensus are different claims and must not be phrased identically.
 */
export function coverage(read: CrossProductRead): { reporting: number; total: number; label: string } {
  const total = read.reporting.length + read.missing.length;
  return {
    reporting: read.reporting.length,
    total,
    label: `${read.reporting.length}/${total} products reporting`,
  };
}
