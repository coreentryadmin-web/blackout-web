import type { FlowAlert } from "@/lib/api";
import { executionRouteKey } from "@/features/helix/lib/helix-flow-format";
import { HELIX_NET_PREMIUM_LEADERS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";

/** Net-premium leaderboard — same aggregation as HELIX NetPremiumLeaderboard panel. */
export function netPremiumLeaders(alerts: FlowAlert[], limit = HELIX_NET_PREMIUM_LEADERS_LIMIT) {
  const map = new Map<string, { calls: number; puts: number }>();
  for (const a of alerts) {
    const cur = map.get(a.ticker) ?? { calls: 0, puts: 0 };
    if (a.option_type === "CALL") cur.calls += a.premium;
    else if (a.option_type === "PUT") cur.puts += a.premium;
    map.set(a.ticker, cur);
  }
  return Array.from(map.entries())
    .map(([ticker, { calls, puts }]) => ({
      ticker,
      calls,
      puts,
      net: calls - puts,
      total: calls + puts,
      call_pct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : 50,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** Route breakdown — same buckets as HELIX RouteBreakdown panel. */
export function routeBreakdown(alerts: FlowAlert[]) {
  const map = new Map<string, { premium: number; count: number }>();
  for (const a of alerts) {
    const key = executionRouteKey(a);
    const cur = map.get(key) ?? { premium: 0, count: 0 };
    cur.premium += a.premium;
    cur.count += 1;
    map.set(key, cur);
  }
  const total = [...map.values()].reduce((s, v) => s + v.premium, 0);
  return [...map.entries()]
    .map(([route, { premium, count }]) => ({
      route,
      premium,
      count,
      pct: total > 0 ? Math.round((premium / total) * 100) : 0,
    }))
    .sort((a, b) => b.premium - a.premium);
}

/** Expiry concentration — same shape as HELIX ExpiryConcentration panel. */
export function expiryConcentration(alerts: FlowAlert[], limit = 8) {
  const map = new Map<string, { premium: number; count: number }>();
  for (const a of alerts) {
    const key = String(a.expiry ?? "unknown").slice(0, 10);
    const cur = map.get(key) ?? { premium: 0, count: 0 };
    cur.premium += a.premium;
    cur.count += 1;
    map.set(key, cur);
  }
  const total = [...map.values()].reduce((s, v) => s + v.premium, 0);
  return [...map.entries()]
    .map(([expiry, { premium, count }]) => ({
      expiry,
      premium,
      count,
      pct: total > 0 ? Math.round((premium / total) * 100) : 0,
    }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, limit);
}

/** Session-wide call/put skew from the tape. */
export function sessionFlowSkew(alerts: FlowAlert[]) {
  const calls = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const puts = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total = calls + puts;
  return {
    alert_count: alerts.length,
    call_premium: calls,
    put_premium: puts,
    total_premium: total,
    call_pct: total > 0 ? Math.round((calls / total) * 100) : 50,
    whale_prints: alerts.filter((a) => a.premium >= 1_000_000).length,
  };
}
