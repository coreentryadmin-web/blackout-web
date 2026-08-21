import type { FlowAlert } from "@/lib/api";
import { executionRouteKey, daysToExpiry } from "@/features/helix/lib/helix-flow-format";
import { HELIX_NET_PREMIUM_LEADERS_LIMIT } from "@/features/helix/lib/helix-strike-leaders";
import { WHALE_PRINT_PREMIUM } from "@/features/helix/lib/helix-flow-limits";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import { flowEventTimeMs } from "@/lib/flow-timestamp";

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
      // null, not 50. The panel's `: 50` is a RENDERING fallback — it centres a bar that has
      // nothing to show. Handed to a model it becomes a claim: "this name's flow is balanced
      // 50/50", asserted about a name whose premium was never measured. A ticker reaches this
      // map on any print, but only CALL/PUT prints add premium (gap-#6), so a name whose prints
      // are all typeless lands here with total 0 — live-reachable, not hypothetical.
      call_pct: calls + puts > 0 ? Math.round((calls / (calls + puts)) * 100) : null,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * How much of the tape can be classified into an execution route AT ALL.
 *
 * `executionRouteKey` looks for six venue keywords (SWEEP/BLOCK/SPLIT/CROSS/FLOOR/MULTI) inside
 * `alert_rule` and returns OTHER for everything else. Two facts about the live tape make OTHER
 * the answer almost always, and neither is visible in a bucket list:
 *
 *   1. **`alert_rule` is absent on most prints.** Measured live 2026-08-21 over a 5,000-row /
 *      168h tape: present on 1,285 rows — **25.7%**.
 *   2. **The rules that ARE present mostly do not name a route.** 1,231 of those 1,285 (95.8%)
 *      are `RepeatedHits` / `RepeatedHitsAscendingFill` / `RepeatedHitsDescendingFill` — a real
 *      UW rule describing a PATTERN, not a venue, so they fall to OTHER too.
 *
 * Net: **OTHER 4,946 (98.9%), FLOOR 50, SWEEP 4** — and the member chip read
 * "OTHER leading :: 100% of tape premium". That is absence rendered as a finding: it sounds like
 * a claim that flow went through an unclassified venue, when the truth is that we have no route
 * data for three quarters of the tape and a pattern label for most of the rest.
 */
export function routeCoverage(alerts: FlowAlert[]) {
  const withRule = alerts.filter((a) => a.alert_rule).length;
  const routed = alerts.filter((a) => a.alert_rule && executionRouteKey(a) !== "OTHER").length;
  return {
    prints: alerts.length,
    /** Prints carrying any `alert_rule` at all. */
    prints_with_alert_rule: withRule,
    /** Prints whose rule actually names an execution route — the only ones the buckets describe. */
    prints_with_known_route: routed,
    // null, not 0, on an empty tape: no prints means no coverage to report, not 0% coverage.
    known_route_pct: alerts.length > 0 ? Math.round((routed / alerts.length) * 1000) / 10 : null,
    /** True when the buckets describe so little of the tape that "OTHER leads" is a statement
     *  about MISSING DATA rather than about flow. Read this before quoting a route share. */
    route_data_sparse: alerts.length > 0 ? routed / alerts.length < 0.1 : false,
  };
}

/** Route breakdown — same buckets as HELIX RouteBreakdown panel.
 *  Read `routeCoverage()` alongside it: OTHER dominates because the route field is mostly
 *  absent, not because the flow is unusual. */
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
      // null, not 0, when there is no premium to take a share OF. `pct` is a share-of-total, so
      // with a zero denominator "0%" is not a small share — it is no measurement at all, and a
      // route row only exists because prints landed on it. Same rule as call_pct (_COMMON.md #7).
      pct: total > 0 ? Math.round((premium / total) * 100) : null,
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
      pct: null as number | null,
    };
  });
  const total = rows.reduce((s, r) => s + r.premium, 0);
  // null on a zero denominator — a horizon holding prints with no measurable premium has no
  // share, which is a different fact from a 0% share.
  for (const r of rows) r.pct = total > 0 ? Math.round((r.premium / total) * 100) : null;
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
    const rowDte = dteOf(a, now);
    const cur = map.get(key) ?? { premium: 0, count: 0, dte: rowDte };
    cur.premium += a.premium;
    cur.count += 1;
    // MIN, not first-seen. Every row under one expiry key should carry the same DTE — both come
    // from the same ET-anchored query — so today these are identical and this changes nothing.
    // But "should" was doing load-bearing work: first-seen makes the reported DTE depend on ROW
    // ORDER, and this function's whole purpose is to stop a horizon being decided by ordering.
    // Min is order-independent by construction, keeps SQL's authoritative (possibly negative,
    // i.e. expired) value rather than recomputing it, and resolves any future disagreement toward
    // the NEARER horizon — the conservative answer when the question is "is this 0DTE".
    cur.dte = Math.min(cur.dte, rowDte);
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
      pct: total > 0 ? Math.round((premium / total) * 100) : null,
    }))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, limit);
}

/**
 * Session-wide call/put skew from the tape.
 *
 * `call_pct` is null when nothing measurable is on the tape, NEVER 50. An empty or quiet window
 * is routine — the last-1h read at 00:47 ET on 2026-08-20 returned zero prints — and 50 reads to
 * a model as a measured, perfectly balanced tape rather than as the absence of a measurement.
 * The same substitution of a default for an absent value produced the peer-relative-strength
 * defect (FINDINGS 2026-08-19), where a verdict was manufactured out of two nulls.
 *
 * `whale_prints` and `total_premium` count DIFFERENT populations on purpose: a whale is any
 * print at or above the threshold, while premium is only summed for CALL/PUT prints (gap-#6
 * leaves typeless prints out of both sides). That is why `{whale_prints: 1, total_premium: 0}`
 * is reachable and is not a contradiction — `typeless_prints` is reported so the gap between the
 * two counts is explainable from the payload instead of looking like a broken sum.
 */
export function sessionFlowSkew(alerts: FlowAlert[]) {
  const calls = alerts.filter((a) => a.option_type === "CALL").reduce((s, a) => s + a.premium, 0);
  const puts = alerts.filter((a) => a.option_type === "PUT").reduce((s, a) => s + a.premium, 0);
  const total = calls + puts;
  return {
    alert_count: alerts.length,
    call_premium: calls,
    put_premium: puts,
    total_premium: total,
    call_pct: total > 0 ? Math.round((calls / total) * 100) : null,
    whale_prints: alerts.filter((a) => a.premium >= WHALE_PRINT_PREMIUM).length,
    /** Prints that are neither CALL nor PUT — counted in alert_count/whale_prints but in
     *  neither premium leg, so this is the reconciliation between the two. */
    typeless_prints: alerts.filter(
      (a) => a.option_type !== "CALL" && a.option_type !== "PUT"
    ).length,
  };
}

/**
 * What the returned tape ACTUALLY covers, as opposed to what was asked for.
 *
 * WHY THIS EXISTS. A tape read is bounded by TWO things — a time window and a row LIMIT — and
 * the limit almost always binds first. Measured live 2026-08-20: a **168-hour** request with
 * `limit: 500` came back with 500 rows spanning **19:55 to 20:49 UTC — 54 minutes**. Even at
 * `limit: 5000` the span was 5.4 hours, not 168. Reporting the REQUESTED window as the window
 * lets a model say "over the last 7 days SPX leads net premium with $280M" about fifty-four
 * minutes of tape. The requested bound is an intent; only the prints themselves are evidence.
 *
 * `limit_reached` is the tell: when it is true the window did not bind, the limit did, and
 * `actual_hours` is the only honest description of the population.
 *
 * Times come from `flowEventTimeMs` — the SAME helper the /flows desk uses for its LIVE badge and
 * its 5-minute stale flip — NOT from `alerted_at`. The two differ constantly: `alerted_at` falls
 * back to INGEST time when UW sends no timestamp, and such a row is flagged `tape_time_estimated`
 * precisely so freshness will ignore it. Measured live 2026-08-20: **438 of 500 prints (87.6%)
 * were `tape_time_estimated`**, only 62 carried a real UW print time, and reading `alerted_at`
 * instead reported the tape as **282 minutes old against the desk's 309** — 27 minutes fresher
 * than it was. Dating a print by when WE received it, and calling that freshness, is the same
 * fabrication this module exists to prevent.
 *
 * Prints with no usable print time are counted out rather than silently widening or narrowing
 * the span, and reported so the model can see how much of the tape is ingest-stamped.
 */
export function tapeWindowCoverage(
  alerts: FlowAlert[],
  requestedHours: number,
  limit: number,
  now: Date = new Date()
) {
  const ts = alerts
    .map((a) => flowEventTimeMs(a))
    .filter((n): n is number => n != null && Number.isFinite(n))
    .sort((a, b) => a - b);
  const undated = alerts.length - ts.length;
  if (!ts.length) {
    return {
      requested_hours: requestedHours,
      actual_hours: null,
      actual_minutes: null,
      oldest_print: null,
      newest_print: null,
      // Present-and-null, never ABSENT: the tool description instructs the model to read this
      // field, so dropping the key on the branch that most needs it makes the instruction
      // unfollowable. `no_dated_print_reason` distinguishes which of the two nulls this is.
      newest_age_minutes: null,
      no_dated_print_reason: alerts.length === 0 ? "no_prints_in_window" : "all_prints_undated",
      timed_prints: 0,
      prints: alerts.length,
      /** Prints with no REAL print time — UW sent none, so the row is ingest-stamped
       *  (`tape_time_estimated`) and is excluded from the span, exactly as the desk excludes it
       *  from LIVE. Routinely the MAJORITY of the tape: 438/500 live on 2026-08-20. */
      undated_prints: undated,
      limit_reached: alerts.length >= limit,
    };
  }
  const oldest = ts[0];
  const newest = ts[ts.length - 1];
  return {
    requested_hours: requestedHours,
    /**
     * Span of the prints themselves — oldest to newest, NOT oldest-to-now.
     *
     * NOT rounded here. Rounding inside a compute path is what C9 forbids, and the harm is
     * immediate: at 1dp any span under 3 minutes becomes exactly `0`, and the tool description
     * tells the model to quote this field as the period analysed — so a 90-second burst of 500
     * SPX prints would be reported as "over 0 hours". That is the same zero-hour fabrication this
     * module's own empty-tape test forbids, re-entering through the rounding. Reachable today at
     * `limit: 120` (mini-panel, desk-scope-prefetch) and on any small limit a "right now" question
     * passes. roundFloats already rounds this payload once at the model's boundary.
     */
    actual_hours: (newest - oldest) / 3_600_000,
    /** The same span in whole minutes — a short burst is a real measurement, and at hour scale it
     *  would round away to a zero that reads as "no span at all". */
    actual_minutes: Math.round((newest - oldest) / 60_000),
    no_dated_print_reason: null,
    oldest_print: etStamp(oldest),
    newest_print: etStamp(newest),
    /** How stale the freshest print is — an off-hours read can be current AND hours old. */
    newest_age_minutes: Math.max(0, Math.round((now.getTime() - newest) / 60_000)),
    prints: alerts.length,
    /** Prints carrying a real UW print time — the only ones the span above is measured from. */
    timed_prints: ts.length,
    /** See above: ingest-stamped prints, excluded from the span the way the desk excludes them
     *  from LIVE. When this dwarfs `timed_prints`, most of the tape cannot be dated at all. */
    undated_prints: undated,
    limit_reached: alerts.length >= limit,
  };
}

/**
 * The tape request BOTH HELIX Largo tools issue — the layer where the population is chosen.
 *
 * Extracted as a pure function because that choice is what broke, twice, and it was untestable
 * where it lived: it sat inline in `product-reads.ts`, whose import graph reaches `server-only`,
 * so no unit test could ever reach it. Every existing test built a fixture array and called the
 * aggregation functions directly, which cannot see a defect in how the rows are SELECTED.
 *
 * `order: "recent"` is the load-bearing field and is not a sort preference. Left unset,
 * `getFlowTape` only infers "recent" when `since_hours <= 6`, so both tools fell through to
 * `ORDER BY total_premium DESC` — the biggest prints of two days. Ordering decides which prints
 * survive the LIMIT, i.e. it selects a different POPULATION. Measured live 2026-08-20 at the same
 * 400-row limit: premium-ordered vs recent-ordered overlapped 0 of 10 stacked_hits and 0 of 12
 * top_prints — identical counts, entirely disjoint contents, top-print direction inverted.
 */
export function helixTapeFetchOptions(opts: {
  ticker?: string | null;
  limit: number;
  sinceHours?: number;
  maxLimit: number;
  defaultSinceHours: number;
  maxSinceHours: number;
}) {
  const { ticker, limit, sinceHours, maxLimit, defaultSinceHours, maxSinceHours } = opts;
  const hours = Number.isFinite(sinceHours as number)
    ? Math.floor(sinceHours as number)
    : defaultSinceHours;
  return {
    // Guarded the same way as the window. Math.floor(NaN) is NaN, and an unguarded NaN reaches
    // Postgres as `LIMIT NaN`, which throws and surfaces to the model as available:false — a
    // healthy tool reported as broken because one argument was bad.
    limit: Math.min(maxLimit, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : maxLimit)),
    ticker: ticker ? ticker.toUpperCase() : undefined,
    since_hours: Math.min(maxSinceHours, Math.max(1, hours)),
    order: "recent" as const,
  };
}
