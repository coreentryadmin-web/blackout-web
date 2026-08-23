/**
 * ONE statement of what a print says about direction — shared by every surface that says it.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────────────────────
 *
 * Two HELIX surfaces render the words "bullish" and "bearish" to the same member on the same page,
 * from two different rules:
 *
 *  - `printBias` (the contract drilldown) reads option_type **× the aggressor side**: a call BOUGHT
 *    or a put SOLD is bullish; a put bought or a call sold is bearish.
 *  - `detectSplitFlow` (Split Flow Radar) read option_type **alone** — all call premium counted as
 *    bullish regardless of whether it was bought or sold.
 *
 * MEASURED (live prod tape, 5000 rows / 168h, 2026-08-23, over the 1454 rows carrying `ask_pct`):
 *   CALL premium $346.3M — bought $181.0M (52.3%), **SOLD $165.3M (47.7%)**
 *   PUT  premium $183.6M — bought  $86.7M (47.2%), **SOLD  $96.9M (52.8%)**
 *   whole tape: option_type alone reads 65.4% bullish; aggression-aware reads 52.4%
 *   **per ticker (>=3 decisive prints): 37 of 83 — 44.6% — SIGN-FLIP between the two rules.**
 *   e.g. TSLA over 94 prints / $34.0M reads bullish by option_type and bearish once you account
 *   for who was buying. Also GLD, INTC, MSTR (bullish -> bearish) and SPXW, MRNA, TLT, AVGO
 *   (bearish -> bullish).
 *
 * That is not a rounding difference between two presentations. It is a direction, and on this
 * lane's own product contract, cross-surface disagreement must be represented rather than left to
 * be discovered by a member reading both panels.
 *
 * ── THIS IS AN INFERENCE, AND THE PRODUCT ALREADY MADE IT ───────────────────────────────────────
 *
 * "Sold call = bearish" is not arithmetic. A sold call may be a covered call (neutral), a naked
 * short (bearish), or a long position being closed (was bullish). `printBias` already takes the
 * bearish reading and ships it. This module does NOT introduce that interpretation — it stops the
 * radar from contradicting it. Where the aggressor is unknown or at the midpoint, the answer is
 * `undetermined`, never a guess.
 */

/** Ask-side share (0-100) at or above which the print reads as buyer-initiated. */
export const ASK_SIDE_BOUGHT_PCT = 60;
/** Ask-side share at or below which the print reads as seller-initiated. */
export const ASK_SIDE_SOLD_PCT = 40;

export type AggressorSide = "bought" | "sold" | "undetermined";
export type FlowDirection = "bullish" | "bearish" | "undetermined";

/**
 * Which side initiated. Thresholds match `aggressorRead` in `helix-print-detail.ts`, which is the
 * copy already shipping to members — they are re-stated here as named constants rather than
 * duplicated magic numbers, and `helix-print-detail.test.ts` pins the two to agree.
 */
export function aggressorSide(askPct: number | null | undefined): AggressorSide {
  if (askPct == null || !Number.isFinite(Number(askPct))) return "undetermined";
  const pct = Number(askPct);
  if (pct >= ASK_SIDE_BOUGHT_PCT) return "bought";
  if (pct <= ASK_SIDE_SOLD_PCT) return "sold";
  return "undetermined";
}

/**
 * What one print says about the underlying. The four-way table, stated once:
 *
 *   CALL bought -> bullish      CALL sold -> bearish
 *   PUT  bought -> bearish      PUT  sold -> bullish
 *
 * `undetermined` whenever the side is unknown or the option type is not CALL/PUT — never folded
 * into either direction, because a midpoint print is not a small bullish print.
 */
export function flowDirection(
  flow: { option_type?: string | null; ask_pct?: number | null }
): FlowDirection {
  const side = aggressorSide(flow.ask_pct);
  if (side === "undetermined") return "undetermined";
  const type = String(flow.option_type ?? "").toUpperCase();
  if (type !== "CALL" && type !== "PUT") return "undetermined";
  const bought = side === "bought";
  if (type === "CALL") return bought ? "bullish" : "bearish";
  return bought ? "bearish" : "bullish";
}

export type DirectionalPremium = {
  bullish: number;
  bearish: number;
  /** Premium whose direction could not be read. Reported, never folded into either side —
   *  otherwise a tape with no aggressor data would read as perfectly balanced conviction. */
  undetermined: number;
};

/** Sum premium into the three buckets. Pure. */
export function directionalPremium(
  flows: ReadonlyArray<{ option_type?: string | null; ask_pct?: number | null; premium: number }>
): DirectionalPremium {
  const out: DirectionalPremium = { bullish: 0, bearish: 0, undetermined: 0 };
  for (const f of flows) {
    const premium = Number(f.premium);
    if (!Number.isFinite(premium) || premium <= 0) continue;
    out[flowDirection(f)] += premium;
  }
  return out;
}

/**
 * The label for a bucketed split. `undetermined` when neither side leads by the margin, or when
 * more premium is unreadable than either readable side — a verdict resting on a minority of the
 * premium is not a verdict.
 */
export function directionLabel(p: DirectionalPremium): FlowDirection | "mixed" {
  const readable = p.bullish + p.bearish;
  if (readable <= 0) return "undetermined";
  if (p.undetermined > readable) return "undetermined";
  const bullPct = (p.bullish / readable) * 100;
  if (bullPct >= 60) return "bullish";
  if (bullPct <= 40) return "bearish";
  return "mixed";
}

/**
 * Marks which rule produced a persisted `direction`. Stamped into the signal ledger's `context`
 * so rows graded under the old option_type-only rule are never pooled with rows graded under this
 * one — the two answer different questions and their success rates are not comparable.
 *
 * Bump this if the rule changes again.
 */
export const DIRECTION_BASIS = "aggression_aware_v1" as const;
