/**
 * Multi-day contract history — aggregates PERSISTED flow_alerts rows (Postgres, via
 * fetchRecentFlows scoped to one contract) by calendar day, so a member can see whether a
 * contract's flow built over several sessions or today is a one-off spike.
 *
 * Deliberately a SEPARATE module from contract-drilldown-parse.ts: that file parses UW's live
 * option-contract API (today-only, no persistence) — a different data source with a different
 * shape and a different question ("what does this contract look like right now") than this one
 * ("how has it looked over the last N sessions"). Keeping them apart means neither file's own
 * scope comment goes stale by picking up a case it wasn't written to cover.
 */

/** The minimal shape this needs from a flow_alerts row — a subset of FlowRow (lib/db.ts), typed
 *  locally so this stays a plain, dependency-free pure module rather than importing a
 *  server-only (pg-backed) type just for its shape. */
export type HistoryRow = {
  /** ISO timestamp or ''. Empty/unparseable rows are dropped — see groupFlowHistoryByDay. */
  alerted_at: string;
  premium: number;
  option_type: string;
};

export type ContractHistoryDay = {
  /** ET calendar date, 'YYYY-MM-DD'. */
  date: string;
  callPremium: number;
  putPremium: number;
  total: number;
  count: number;
};

/**
 * Group rows by their ET calendar date and sum premium (call/put separately).
 *
 * Dates are the print's OWN alerted_at, read in America/New_York — matching how every other
 * DTE/expiry-bucketing surface in HELIX (bucketLabel in ExpiryConcentration.tsx, the SQL DTE
 * expression in fetchRecentFlows) already anchors to ET rather than the server/browser's own
 * timezone, so "today" here means the same session a member reading the live tape calls today.
 *
 * Rows with an empty/unparseable alerted_at are dropped, not bucketed under an arbitrary date —
 * see FlowRow.alerted_at's own comment: '' is UW's real "no print timestamp" sentinel, not a
 * missing-but-inferable value.
 */
export function groupFlowHistoryByDay(rows: readonly HistoryRow[]): ContractHistoryDay[] {
  const map = new Map<string, { callPremium: number; putPremium: number; count: number }>();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }); // en-CA => YYYY-MM-DD

  for (const r of rows) {
    if (!r.alerted_at) continue;
    const ms = Date.parse(r.alerted_at);
    if (!Number.isFinite(ms)) continue;
    const date = fmt.format(new Date(ms));
    const cur = map.get(date) ?? { callPremium: 0, putPremium: 0, count: 0 };
    if (r.option_type.toUpperCase() === "PUT") cur.putPremium += r.premium;
    else if (r.option_type.toUpperCase() === "CALL") cur.callPremium += r.premium;
    cur.count++;
    map.set(date, cur);
  }

  return Array.from(map.entries())
    .map(([date, { callPremium, putPremium, count }]) => ({
      date,
      callPremium,
      putPremium,
      total: callPremium + putPremium,
      count,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest day first
}
