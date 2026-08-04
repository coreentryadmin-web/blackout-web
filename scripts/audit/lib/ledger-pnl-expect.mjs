/** Mirror reconcileLedgerLivePnlPct / PLAN_RULES.stop_pct for audit scripts. */
const STOP_PCT = -50;
const TRIM_TRANCHE_PCTS = [25, 50];
const TRIM_TRANCHE_FRAC = 1 / 3;

function trimScaleBlendedAtStop(peakPnlPct) {
  if (peakPnlPct == null || !Number.isFinite(peakPnlPct)) return null;
  let armed = 0;
  for (const t of TRIM_TRANCHE_PCTS) if (peakPnlPct >= t) armed += 1;
  if (armed === 0) return null;
  let blended = 0;
  let remaining = 1;
  for (let i = 0; i < armed; i++) {
    blended += TRIM_TRANCHE_FRAC * TRIM_TRANCHE_PCTS[i];
    remaining -= TRIM_TRANCHE_FRAC;
  }
  blended += remaining * STOP_PCT;
  return Math.round(blended * 100) / 100;
}

function peakPnlPct(entry, peak) {
  if (entry == null || entry <= 0 || peak == null) return null;
  return Math.round(((peak - entry) / entry) * 10000) / 100;
}

export function expectedLedgerPnlPct(row) {
  if (row.is_condor) {
    if (row.entry_premium != null && row.last_mark != null) {
      return Math.round(((row.entry_premium - row.last_mark) / row.entry_premium) * 10000) / 100;
    }
    return null;
  }
  if (row.closed_reason === "stopped") {
    const managed = trimScaleBlendedAtStop(peakPnlPct(row.entry_premium, row.peak_premium));
    return managed ?? STOP_PCT;
  }
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
