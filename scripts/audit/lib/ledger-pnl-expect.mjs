/** Mirror reconcileLedgerLivePnlPct / PLAN_RULES.stop_pct for audit scripts. */
const STOP_PCT = -50;

export function expectedLedgerPnlPct(row) {
  if (row.is_condor) {
    if (row.entry_premium != null && row.last_mark != null) {
      return Math.round(((row.entry_premium - row.last_mark) / row.entry_premium) * 10000) / 100;
    }
    return null;
  }
  if (row.closed_reason === "stopped") return STOP_PCT;
  if (row.entry_premium != null && row.last_mark != null) {
    return Math.round(((row.last_mark - row.entry_premium) / row.entry_premium) * 10000) / 100;
  }
  return null;
}

export function ledgerPnlMatches(row, tolerance = 0.05) {
  const expected = expectedLedgerPnlPct(row);
  if (expected == null || row.live_pnl_pct == null) return true;
  return Math.abs(expected - row.live_pnl_pct) <= tolerance;
}
