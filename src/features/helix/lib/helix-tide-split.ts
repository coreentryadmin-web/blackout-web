/**
 * Decompose UW's market tide into BULLISH vs BEARISH flow.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `net_call_premium` and `net_put_premium` are **signed** — UW nets ask-side against bid-side, so a
 * negative value means that side was net SOLD. Verified live 2026-08-21 (81 five-minute snapshots,
 * one full session): `net_put_premium` was negative on **81 of 81** rows and `net_call_premium` on
 * 8 of 81.
 *
 * `HelixTideBar` treated them as magnitudes:
 *
 *     const gross = call + put;
 *     const callPct = gross > 0 ? (call / gross) * 100 : 50;
 *
 * Measured over that same session, every snapshot misrendered:
 *   - `gross <= 0` on **50/81 (61.7%)** -> the bar fell back to a FLAT 50/50 while the bias pill
 *     beside it read BULLISH. Two halves of one component contradicting each other.
 *   - `callPct > 100%` on **31/81** -> the green bar's width style exceeded 100%.
 *   - the puts label is gated on `put > 0`, so it rendered on **0 of 81** snapshots.
 *
 * Adding the two signed numbers is the bug: a bullish tape where calls are bought (+) and puts are
 * sold (-) has those two effects CANCEL in a sum, when they in fact reinforce.
 *
 * ── THE DECOMPOSITION ───────────────────────────────────────────────────────────────────────────
 *
 * Same four-way table `helix-flow-aggression.ts` states for a single print, applied to net premium:
 *
 *     calls BOUGHT (+net_call) -> bullish        calls SOLD (-net_call) -> bearish
 *     puts  SOLD   (-net_put)  -> bullish        puts  BOUGHT (+net_put) -> bearish
 *
 * so `bullish = max(call, 0) + max(-put, 0)` and `bearish = max(-call, 0) + max(put, 0)`. Both are
 * non-negative by construction, so their ratio is a real proportion — always within 0–100, never a
 * width style of 250%.
 *
 * This also makes the bar agree with the bias pill **by construction** rather than by coincidence:
 * `bullish > bearish` is exactly `net_call - net_put > 0`, which is the `net` the store already
 * computes and the pill already reads. There is a test asserting that equivalence.
 */

export type TideSplit = {
  /** Calls bought plus puts sold. Non-negative. */
  bullish: number;
  /** Calls sold plus puts bought. Non-negative. */
  bearish: number;
  /** Share of directional flow that is bullish, 0–100. `null` when there is NO flow to split —
   *  which must render as "no reading", never as a 50/50 bar implying measured balance. */
  bullishPct: number | null;
  /** True when either input was missing or unusable, so the caller can say so instead of drawing
   *  a bar over nothing. */
  unavailable: boolean;
};

const EMPTY: TideSplit = { bullish: 0, bearish: 0, bullishPct: null, unavailable: true };

export function tideSplit(
  netCallPremium: number | null | undefined,
  netPutPremium: number | null | undefined
): TideSplit {
  // Absent is not zero. A tide with no data must not render as perfectly balanced flow — that is
  // the same absence-as-measurement failure the flat 50/50 fallback committed.
  if (typeof netCallPremium !== "number" || !Number.isFinite(netCallPremium)) return EMPTY;
  if (typeof netPutPremium !== "number" || !Number.isFinite(netPutPremium)) return EMPTY;

  const bullish = Math.max(netCallPremium, 0) + Math.max(-netPutPremium, 0);
  const bearish = Math.max(-netCallPremium, 0) + Math.max(netPutPremium, 0);
  const total = bullish + bearish;
  return {
    bullish,
    bearish,
    // A genuinely flat tape (both sides exactly zero) has nothing to split. Reporting null rather
    // than 50 keeps "no flow" distinguishable from "balanced flow".
    bullishPct: total > 0 ? (bullish / total) * 100 : null,
    unavailable: false,
  };
}

/**
 * Label for a signed net premium, stating its SENSE rather than hiding it.
 *
 * The old bar gated each label on `value > 0`, so a net-sold side simply vanished — and net put
 * premium was negative on every snapshot measured, so the puts figure never appeared at all. A
 * member saw one number and no indication the other existed.
 */
export function netPremiumSense(value: number | null | undefined): "bought" | "sold" | "flat" | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 0) return "bought";
  if (value < 0) return "sold";
  return "flat";
}
