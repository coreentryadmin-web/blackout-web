/**
 * Extract per-print chain context from a UW raw alert/print payload.
 * Mirrors the SQL casts in db.ts fetchRecentFlows so SSE rows match REST rows.
 */
import type { MarketFlowAlert } from "@/lib/providers/unusual-whales";

function numFromRaw(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v == null) continue;
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && /^-?[0-9]+(\.[0-9]+)?$/.test(v)
          ? Number(v)
          : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export type FlowChainFields = {
  fill_price?: number;
  ask_pct?: number;
  underlying_price?: number;
  open_interest?: number;
  implied_volatility?: number;
  otm_pct?: number;
  alert_rule?: string;
};

/**
 * Ask-side share of a print's two-sided premium, as a 0-100 PERCENTAGE — the SAME scale UW's
 * own `ask_side_pct` uses and that every downstream consumer reads: board.ts aggressionWeight's
 * 60/45 thresholds, helix aggressorRead/printBias (`askPct >= 60` = bought, `<= 40` = sold), and
 * the FlowAlertStream "% ask" chip. It is deliberately NOT a 0-1 fraction: returning 0.70 for a
 * 70%-at-ask print would land under aggressionWeight's 45 floor and be bucketed as fully SOLD
 * premium (weight 0.15) — inverting conviction on every derived print instead of confirming it.
 *
 * Why this exists: UW does NOT send `ask_side_pct` on the flow_alerts feed (live-verified
 * 2026-07-24: 0/2780 rows) but DOES send total_ask_side_prem + total_bid_side_prem on 100% of
 * rows, so this is how aggressor conviction is actually recovered in production. Mirrors the
 * premium-ratio branch in src/features/nighthawk/lib/scorer.ts.
 *
 * Returns undefined (NOT 0) when the two-sided premium is unusable — either side missing, or a
 * zero denominator — so an unknown reading stays null (aggressionWeight's neutral 0.5) rather
 * than masquerading as "100% sold" (0). bid=0 with ask>0 is a legitimate fully-at-ask print → 100.
 */
export function askPctFromTwoSidedPremium(
  askPrem: number | undefined,
  bidPrem: number | undefined
): number | undefined {
  if (askPrem == null || bidPrem == null) return undefined;
  const total = askPrem + bidPrem;
  if (!(total > 0)) return undefined; // divide-by-zero guard -> undefined, never 0
  return (askPrem / total) * 100;
}

export function extractChainFieldsFromRaw(
  raw: Record<string, unknown>,
  flow: Pick<MarketFlowAlert, "strike" | "option_type">
): FlowChainFields {
  const fill_price = numFromRaw(raw, "price");
  // Prefer a real `ask_side_pct` (0-100) if UW ever sends it; otherwise DERIVE the ask-side
  // share from the total_ask/bid premium UW actually does send (see askPctFromTwoSidedPremium).
  // Was `numFromRaw(raw, "ask_side_pct")` alone — null on every production print (UW omits that
  // field), which pinned board.ts aggressionWeight to the neutral 0.5 for every ticker: a dead
  // SETUP_MIN_AGGR_SHARE gate and direction decided by raw call/put premium, not aggressor flow.
  const ask_pct =
    numFromRaw(raw, "ask_side_pct") ??
    askPctFromTwoSidedPremium(
      numFromRaw(raw, "total_ask_side_prem"),
      numFromRaw(raw, "total_bid_side_prem")
    );
  const underlying_price = numFromRaw(raw, "underlying_last", "underlying_price", "stock_price");
  const open_interest = numFromRaw(raw, "open_interest", "oi");
  const implied_volatility = numFromRaw(raw, "iv", "implied_volatility");

  let otm_pct: number | undefined;
  if (underlying_price != null && underlying_price > 0 && flow.strike > 0) {
    const opt = flow.option_type.toLowerCase();
    if (opt.startsWith("c") || opt.startsWith("p")) {
      const isCall = opt.startsWith("c");
      otm_pct =
        Math.round(
          ((isCall ? flow.strike - underlying_price : underlying_price - flow.strike) /
            underlying_price) *
            1000
        ) / 10;
    }
  }

  const ruleRaw = String(raw.alert_rule ?? raw.rule_name ?? "").trim();
  return {
    fill_price,
    ask_pct,
    underlying_price,
    open_interest,
    implied_volatility,
    otm_pct,
    alert_rule: ruleRaw || undefined,
  };
}
