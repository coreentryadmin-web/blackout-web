/** SPX desk vs Polygon I:SPX oracle — same % tolerances as scripts/audit/data-validator.mjs. */
export function spxOracleTolerancePct(marketOpen) {
  return marketOpen ? 0.3 : 1.5;
}

export function evaluateSpxOracleAgreement(deskSpx, oracle, marketOpen) {
  if (!(Number.isFinite(deskSpx) && deskSpx > 0 && Number.isFinite(oracle) && oracle > 0)) {
    return { ok: false, reason: "missing_values", delta: null, pct: null, tolPct: spxOracleTolerancePct(marketOpen) };
  }
  const delta = Math.abs(oracle - deskSpx);
  const pct = (delta / oracle) * 100;
  const tolPct = spxOracleTolerancePct(marketOpen);
  return { ok: pct <= tolPct, delta, pct, tolPct, reason: pct <= tolPct ? "within_tol" : "exceeds_tol" };
}
