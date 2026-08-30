/**
 * HELIX tape aggregates for thesis rails — built from scan's existing fetchRecentFlows
 * batch (Postgres flow_alerts), not a per-ticker upstream call.
 */
import type { LegacyBridgeExtras } from "./rails/legacy-bridge";

export type HelixFlowRow = {
  ticker: string;
  premium: number;
  option_type: string;
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

export function aggregateHelixTapeByTicker(rows: HelixFlowRow[]): Map<string, HelixTapeAggregate> {
  const byTicker = new Map<string, HelixTapeAggregate>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    if (!ticker) continue;
    const prem = Number.isFinite(row.premium) ? row.premium : 0;
    const isCall = String(row.option_type).toLowerCase().startsWith("c");
    const agg = byTicker.get(ticker) ?? {
      print_count: 0,
      gross_premium: 0,
      call_premium: 0,
      put_premium: 0,
      direction_bias: null,
    };
    agg.print_count += 1;
    agg.gross_premium += prem;
    if (isCall) agg.call_premium += prem;
    else agg.put_premium += prem;
    byTicker.set(ticker, agg);
  }
  for (const agg of byTicker.values()) {
    const total = agg.call_premium + agg.put_premium;
    if (total <= 0) {
      agg.direction_bias = null;
      continue;
    }
    const callShare = agg.call_premium / total;
    if (callShare >= 0.6) agg.direction_bias = "long";
    else if (callShare <= 0.4) agg.direction_bias = "short";
    else agg.direction_bias = "mixed";
  }
  return byTicker;
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
