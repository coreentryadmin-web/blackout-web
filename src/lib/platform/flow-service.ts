import { fetchRecentFlows } from "@/lib/db";
import { subscribeFlowEvents, publishFlowEvent } from "@/lib/flow-events";
import {
  computeFlowStrikeStacks,
} from "@/lib/largo/flow-strike-stacks";
import { flowTapeCacheTtlMs } from "@/lib/providers/config";
import { withServerCache } from "@/lib/server-cache";
import type { FlowTapeSummary } from "./types";

export { subscribeFlowEvents, publishFlowEvent };

export async function getFlowTape(opts?: { ticker?: string; limit?: number }) {
  const limit = opts?.limit ?? 25;
  const ticker = opts?.ticker ? opts.ticker.toUpperCase() : undefined;
  const key = `flows:tape:${ticker ?? "all"}:${limit}`;
  return withServerCache(
    key,
    flowTapeCacheTtlMs(),
    () =>
      fetchRecentFlows({
        limit,
        ticker,
      }),
    { staleWhileRevalidate: true }
  );
}

export async function getFlowTapeSummary(opts?: { ticker?: string; limit?: number }): Promise<FlowTapeSummary> {
  const rows = await getFlowTape(opts);
  const byTicker = new Map<string, { premium: number; count: number }>();

  for (const row of rows) {
    const cur = byTicker.get(row.ticker) ?? { premium: 0, count: 0 };
    cur.premium += row.premium;
    cur.count += 1;
    byTicker.set(row.ticker, cur);
  }

  const top_tickers = Array.from(byTicker.entries())
    .map(([ticker, v]) => ({ ticker, premium: v.premium, count: v.count }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, 10);

  return {
    count: rows.length,
    total_premium: rows.reduce((s, r) => s + r.premium, 0),
    top_tickers,
    recent: rows,
  };
}
