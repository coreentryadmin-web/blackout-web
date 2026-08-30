/**
 * HELIX tape aggregates for thesis rails — built from scan's existing fetchRecentFlows
 * batch (Postgres flow_alerts), not a per-ticker upstream call.
 */
import type { LegacyBridgeExtras } from "./rails/legacy-bridge";
import { directionLabel, directionalPremium } from "@/features/helix/lib/helix-flow-aggression";

export type HelixFlowRow = {
  ticker: string;
  premium: number;
  option_type: string;
  /** Ask-side share (0-100) — the aggressor read. Without it every print is `undetermined`. */
  ask_pct?: number | null;
  alerted_at?: string | null;
};

export type HelixTapeAggregate = {
  print_count: number;
  gross_premium: number;
  call_premium: number;
  put_premium: number;
  /** long = net call bias, short = net put bias */
  direction_bias: "long" | "short" | "mixed" | null;
};

/**
 * `direction_bias` used to be call-share alone (`isCall ? call_premium += prem : put_premium +=
 * prem`, then `callShare >= 0.6 -> "long"`) — the exact "option type without the aggressor"
 * conflation `helix-flow-aggression.ts`'s header measured a 44.6% per-ticker sign-flip rate on
 * (live prod tape, 2026-08-23): a SOLD call reads bearish, not bullish, and this aggregate counted
 * it as bullish regardless. `crossProductCorroborationBoost` (legacy-bridge.ts) adds +5 (+8 with
 * the >=$1M bonus) of REAL 0DTE rail score whenever `helix_direction_bias` agrees with the setup's
 * direction, so a tape that is genuinely bearish-by-aggression could award a false "long" boost.
 * Routed through the SAME `directionalPremium`/`directionLabel` helpers every other HELIX surface
 * uses (`helix-direction-read.ts`, `helix-tape-analytics.ts`) so this aggregate cannot drift back
 * to the naive rule a second time.
 */
export function aggregateHelixTapeByTicker(rows: HelixFlowRow[]): Map<string, HelixTapeAggregate> {
  const byTicker = new Map<string, HelixFlowRow[]>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    if (!ticker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push(row);
    byTicker.set(ticker, list);
  }
  const out = new Map<string, HelixTapeAggregate>();
  for (const [ticker, tickerRows] of byTicker) {
    let callPremium = 0;
    let putPremium = 0;
    let grossPremium = 0;
    for (const row of tickerRows) {
      const prem = Number.isFinite(row.premium) ? row.premium : 0;
      grossPremium += prem;
      const isCall = String(row.option_type).toLowerCase().startsWith("c");
      if (isCall) callPremium += prem;
      else putPremium += prem;
    }
    const premium = directionalPremium(tickerRows);
    const label = directionLabel(premium);
    const direction_bias: HelixTapeAggregate["direction_bias"] =
      label === "bullish" ? "long" : label === "bearish" ? "short" : label === "mixed" ? "mixed" : null;
    out.set(ticker, {
      print_count: tickerRows.length,
      gross_premium: grossPremium,
      call_premium: callPremium,
      put_premium: putPremium,
      direction_bias,
    });
  }
  return out;
}

export function helixTapeToLegacyExtras(agg: HelixTapeAggregate): LegacyBridgeExtras {
  return {
    helix_print_count: agg.print_count,
    helix_gross_premium: agg.gross_premium,
    helix_direction_bias: agg.direction_bias,
  };
}

export function buildHelixExtrasByTicker(rows: HelixFlowRow[]): Record<string, LegacyBridgeExtras> {
  const map = aggregateHelixTapeByTicker(rows);
  const out: Record<string, LegacyBridgeExtras> = {};
  for (const [ticker, agg] of map) {
    out[ticker] = helixTapeToLegacyExtras(agg);
  }
  return out;
}
