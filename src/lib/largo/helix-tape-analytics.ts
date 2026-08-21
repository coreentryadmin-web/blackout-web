import type { FlowAlert } from "@/lib/api";
import { executionRouteKey, daysToExpiry } from "@/features/helix/lib/helix-flow-format";
import { HELIX_NET_PREMIUM_LEADERS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";

/** The member panel's horizon buckets, in CHRONOLOGICAL order (ExpiryConcentration.tsx). */
export const EXPIRY_HORIZONS = ["0DTE", "This week", "Monthly", "LEAPS"] as const;
export type ExpiryHorizon = (typeof EXPIRY_HORIZONS)[number];

/** Same thresholds as ExpiryConcentration.tsx's bucketLabel — kept identical on purpose:
 *  Largo answers questions ABOUT that panel, so a different cut would make the two disagree
 *  about the same tape while both claiming to be "expiry concentration".
 *
 *  ONE deliberate difference: `dte <= 0`, not `dte === 0`. The tape's `dte` is computed in SQL
 *  as `expiry - (NOW() AT TIME ZONE 'America/New_York')::date` and CAN come back negative for an
 *  already-expired print. The panel's `dte === 0` sends those to the `dte <= 7` branch and labels
 *  them "This week" — an expired contract filed under a future horizon. Folding them into 0DTE is
 *  the nearest honest bucket. Not fixed in the panel here: that is a member-facing render change
 *  outside this fix's blast radius, and it is logged separately. */
export function expiryHorizonLabel(dte: number): ExpiryHorizon {
  if (dte <= 0) return "0DTE";
  if (dte <= 7) return "This week";
  if (dte <= 30) return "Monthly";
  return "LEAPS";
}

/** DTE for a print, preferring the value the SQL already computed against the ET calendar date.
 *  daysToExpiry() is the same ET-anchored helper the member panel falls back to, so a row with
 *  no `dte` column lands in the identical bucket on both surfaces. */
function dteOf(a: FlowAlert, now: Date): number {
  return a.dte ?? daysToExpiry(a.expiry, now);
}

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

/**
 * Expiry concentration BY HORIZON — the aggregation the HELIX ExpiryConcentration panel
 * actually renders (0DTE / This week / Monthly / LEAPS), with the call/put split it shows.
 *
 * WHY this exists alongside expiryConcentration(): that function ranks RAW EXPIRY DATES by
 * premium and keeps the top 8, which silently drops the near-dated horizons on any normal
 * tape — 0DTE prints are naturally small next to LEAPS blocks. Measured live 2026-08-20 on a
 * 500-print 48h tape: 24 distinct expiries, and the true 0DTE bucket (2026-08-20, $2.7M,
 * 17 prints) ranked **16th** and never reached the model at all, while the 4th-ranked row
 * (2026-08-21, $33.5M, 120 prints) was 1DTE. A member asking "is there 0DTE flow" got a list
 * whose nearest row was the NEXT session, 12x too big.
 *
 * Never truncated: there are at most four buckets, so the horizon view can always carry every
 * one of them. The $50k floor the panel applies is a RENDERING choice (a sub-pixel bar is
 * noise) and is deliberately NOT applied here — dropping a horizon from a model's evidence is
 * not the same as omitting a bar, and "0DTE: $40k, 2 prints" is a real and useful answer.
 */
export function expiryHorizonConcentration(alerts: FlowAlert[], now: Date = new Date()) {
  const map = new Map<ExpiryHorizon, { call_premium: number; put_premium: number; count: number }>();
  for (const a of alerts) {
    const label = expiryHorizonLabel(dteOf(a, now));
    const cur = map.get(label) ?? { call_premium: 0, put_premium: 0, count: 0 };
    // gap-#6: a typeless print counts toward NEITHER side (same rule as the panel), but it is
    // still a print, so it counts in `count`. That is why premium can be 0 on a non-zero count.
    if (a.option_type === "CALL") cur.call_premium += a.premium;
    else if (a.option_type === "PUT") cur.put_premium += a.premium;
    cur.count += 1;
    map.set(label, cur);
  }
  const rows = EXPIRY_HORIZONS.filter((l) => map.has(l)).map((horizon) => {
    const { call_premium, put_premium, count } = map.get(horizon)!;
    const premium = call_premium + put_premium;
    return {
      horizon,
      count,
      call_premium,
      put_premium,
      premium,
      // null, not 50 — an unmeasurable skew must not read as a measured balance.
      call_pct: premium > 0 ? Math.round((call_premium / premium) * 100) : null,
      pct: 0,
    };
  });
  const total = rows.reduce((s, r) => s + r.premium, 0);
  for (const r of rows) r.pct = total > 0 ? Math.round((r.premium / total) * 100) : 0;
  return rows;
}

/**
 * Expiry concentration by RAW EXPIRY DATE — the per-date detail under the horizon buckets.
 *
 * Every row now carries `dte`, because a bare `expiry: "2026-08-21"` does not tell a model
 * which session it is relative to. Without it the model has to resolve "today" from its own
 * clock, and in the ~8pm-midnight ET window the UTC date is already the NEXT calendar day —
 * so it labels tomorrow's expiry "0DTE" and is wrong by a full session. `dte` is the same
 * ET-anchored number the tape and the member panel use, so no inference is required.
 */
export function expiryConcentration(alerts: FlowAlert[], limit = 8, now: Date = new Date()) {
  const map = new Map<string, { premium: number; count: number; dte: number }>();
  for (const a of alerts) {
    const key = String(a.expiry ?? "unknown").slice(0, 10);
    const cur = map.get(key) ?? { premium: 0, count: 0, dte: dteOf(a, now) };
    cur.premium += a.premium;
    cur.count += 1;
    map.set(key, cur);
  }
  const total = [...map.values()].reduce((s, v) => s + v.premium, 0);
  return [...map.entries()]
    .map(([expiry, { premium, count, dte }]) => ({
      expiry,
      dte,
      horizon: expiryHorizonLabel(dte),
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
