import { fetchRecentFlows } from "@/lib/db";
import { subscribeFlowEvents, publishFlowEvent } from "@/lib/flow-events";
import {
  computeFlowStrikeStacks,
} from "@/lib/largo/flow-strike-stacks";
import { sessionFlowSkew } from "@/lib/largo/helix-tape-analytics";
import type { FlowTapeSummary } from "./types";

export { subscribeFlowEvents, publishFlowEvent };

export async function getFlowTape(opts?: {
  ticker?: string;
  limit?: number;
  since_hours?: number;
  /**
   * Row ordering, which decides which prints survive the LIMIT — not merely their sequence.
   * Left undefined this keeps the historical default (biggest premium first), so every existing
   * caller is unchanged. Pass "recent" to read the tape the way the /flows desk does: a
   * premium-ordered LIMIT systematically drops small-but-current prints (0DTE especially, since
   * those are tiny next to far-dated blocks), which is a different POPULATION, not a different sort.
   */
  order?: "premium" | "recent";
}) {
  return fetchRecentFlows({
    limit: opts?.limit ?? 25,
    ticker: opts?.ticker ? opts.ticker.toUpperCase() : undefined,
    since_hours: opts?.since_hours,
    order: opts?.order ?? (opts?.since_hours != null && opts.since_hours <= 6 ? "recent" : undefined),
  });
}

export async function getFlowTapeSummary(opts?: {
  ticker?: string;
  limit?: number;
  since_hours?: number;
  /** See getFlowTape — additive; omitting it preserves the existing biggest-premium-first read. */
  order?: "premium" | "recent";
}): Promise<FlowTapeSummary> {
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

  const skew = sessionFlowSkew(rows);
  return {
    count: rows.length,
    total_premium: rows.reduce((s, r) => s + r.premium, 0),
    top_tickers,
    recent: rows,
    strike_stacks: computeFlowStrikeStacks(rows, { limit: 24 }),
    window_hours: opts?.since_hours ?? 48,
    // Skew over THIS pull, computed once server-side so no caller hand-sums the capped print list
    // (which produced a 34% / 60% / 83% spread for one "what's the skew" question). Scoped to the
    // pull; the session-wide skew is get_helix_tape_analytics.session.
    pull_skew: {
      call_pct: skew.call_pct,
      call_premium: skew.call_premium,
      put_premium: skew.put_premium,
      total_premium: skew.total_premium,
      prints: rows.length,
    },
  };
}
