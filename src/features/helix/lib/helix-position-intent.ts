import type { FlowAlert } from "@/lib/api";
import { contractSizeExact } from "./helix-contract-size";

/**
 * Is this print OPENING new positioning, or could it be closing something already there?
 *
 * ── WHY THIS IS ARITHMETIC AND NOT A HEURISTIC ──────────────────────────────────────────────────
 *
 * It is the first question a flow desk asks of an unusual print, and the tape has never answered it
 * — while carrying both inputs the whole time.
 *
 * A print's SIZE in contracts is not served, but it is exactly recoverable:
 *
 *     size = premium / (fill_price × 100)
 *
 * (`premium` is total dollars, `fill_price` is per-share, 100 shares per contract.) And OPEN
 * INTEREST is the number of contracts currently outstanding on that exact contract.
 *
 * So if a SINGLE print's size exceeds the open interest, the trade **cannot** be entirely closing:
 * there are not enough open contracts in existence to close. At least `size − OI` contracts are
 * necessarily new. That is a counting argument, not an inference about intent — which is why this
 * is worth shipping where a "sentiment" guess would not be.
 *
 * ── WHAT IT REFUSES TO SAY, WHICH IS MOST OF THE TAPE ───────────────────────────────────────────
 *
 * Below open interest the print is genuinely ambiguous — it could be opening, closing, or both, and
 * nothing in the payload distinguishes them. That is reported as `indeterminate`, never as
 * "closing", because "not provably opening" is not evidence of closing. And a print with no
 * reported open interest was never *examined*, which is a third state again (`unknown`).
 *
 * MEASURED (live prod tape, 5000 rows / 168h, 2026-08-23):
 *   fill_price present      5000 (100.0%)
 *   open_interest present   1500 ( 30.0%)   <- Group A only; the index feed reports none (§4A)
 *   ------------------------------------------------------------------
 *   OI === 0, all-new           12
 *   size ≥ OI × margin         208   -> DECISIVE: 220 of 5000 = 4.4% of the tape,
 *   size < OI × margin        1275      14.7% of the population that can be judged at all
 *   never determinable        3500
 *
 * ── THE MARGIN, AND WHY IT IS NOT ZERO ──────────────────────────────────────────────────────────
 *
 * `size` is DERIVED, so it carries the rounding of whatever produced `premium` and `fill_price` —
 * a swept order reports one averaged fill across legs. Measured over the same 1500 rows, taking
 * distance-to-nearest-integer as the error: **p50 0.0000%, p90 0.0231%, p99 0.0834%, max 0.160%**.
 *
 * `OPEN_INTEREST_MARGIN` is 1.05 — **31× the largest error observed**, and deliberately generous
 * because that measurement is a LOWER bound (a derivation off by more than half a contract lands
 * near a different integer and reads as small error). It costs 5 of 213 rows, which is the right
 * trade for a badge asserting something cannot be true.
 *
 * ── ONE PROPERTY THAT LOOKS LIKE A BUG AND IS NOT ───────────────────────────────────────────────
 *
 * Open interest is published once daily, so it is effectively the PRIOR session's close. That is
 * the correct denominator for this question: today's opening trades are not in it yet, which is
 * precisely why exceeding it proves newness. Do not "fix" it to an intraday figure — that would
 * destroy the argument. It does mean the test is per-PRINT: two prints of 60% of OI each are both
 * individually indeterminate even though together they must have opened something. This function
 * classifies one print and claims nothing about a sequence.
 */

/**
 * How far above open interest a derived size must sit before the print is called opening.
 * 1.05 = 5%; see the header for the measured error this is sized against.
 */
export const OPEN_INTEREST_MARGIN = 1.05;

export type PositionIntent =
  | {
      intent: "opening";
      /** `no_open_interest`: the contract had none outstanding, so every lot is new.
       *  `exceeds_open_interest`: more contracts traded than existed to close. */
      basis: "no_open_interest" | "exceeds_open_interest";
      size: number;
      openInterest: number;
      /** size ÷ OI. `null` when OI is 0 — a ratio against nothing is not a number. */
      ratio: number | null;
    }
  | {
      /** Could be opening, closing, or both. NOT evidence of closing. */
      intent: "indeterminate";
      reason: "within_open_interest";
      size: number;
      openInterest: number;
      ratio: number;
    }
  | {
      /** Nothing was examined — a different fact from "we looked and could not tell". */
      intent: "unknown";
      reason: "open_interest_unreported" | "size_underivable";
    };

/** Classify one print. Pure; the three outcomes are exhaustive and never collapse into each other. */
export function positionIntent(
  flow: Pick<FlowAlert, "premium" | "fill_price" | "open_interest">
): PositionIntent {
  // EXACT, not rounded: the 1.05 margin below was measured against the unrounded quotient.
  // Rounding first would move the opening/indeterminate boundary by up to half a contract.
  const size = contractSizeExact(flow.premium, flow.fill_price);
  if (size == null) return { intent: "unknown", reason: "size_underivable" };

  const oi = Number(flow.open_interest);
  // Absent, non-numeric or negative OI is "never examined", not "zero contracts outstanding".
  // Conflating those two is what would turn an unexamined print into a fabricated OPENING badge.
  if (flow.open_interest == null || !Number.isFinite(oi) || oi < 0) {
    return { intent: "unknown", reason: "open_interest_unreported" };
  }

  if (oi === 0) {
    return { intent: "opening", basis: "no_open_interest", size, openInterest: 0, ratio: null };
  }

  const ratio = size / oi;
  if (size >= oi * OPEN_INTEREST_MARGIN) {
    return { intent: "opening", basis: "exceeds_open_interest", size, openInterest: oi, ratio };
  }
  return { intent: "indeterminate", reason: "within_open_interest", size, openInterest: oi, ratio };
}

/**
 * Badge text for an opening print. `NEW` alone when the ratio is modest; `NEW ×N` once the print is
 * a multiple of everything outstanding, because 78× and 1.1× are not the same claim and a single
 * label for both wastes the strongest signal on the tape.
 */
export function openingBadgeLabel(verdict: PositionIntent): string | null {
  if (verdict.intent !== "opening") return null;
  if (verdict.ratio == null || verdict.ratio < 2) return "NEW";
  return `NEW ${verdict.ratio >= 10 ? Math.round(verdict.ratio) : verdict.ratio.toFixed(1)}×`;
}

/** Full-sentence tooltip. States the counting argument, not just the verdict. */
export function positionIntentTitle(verdict: PositionIntent): string | null {
  if (verdict.intent !== "opening") return null;
  const size = Math.round(verdict.size).toLocaleString();
  if (verdict.basis === "no_open_interest") {
    return `New positioning: ${size} contracts traded on a strike with no open interest — every lot is newly opened.`;
  }
  const oi = verdict.openInterest.toLocaleString();
  return `New positioning: ${size} contracts traded against ${oi} outstanding, so at least ${Math.round(verdict.size - verdict.openInterest).toLocaleString()} are newly opened — this print cannot be entirely closing.`;
}
