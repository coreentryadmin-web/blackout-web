/**
 * SPX desk vs Polygon oracle helpers for scripts/full-site-deep-audit.mjs.
 * Keeps off-hours ground truth aligned with data-validator + spx-desk (today's own
 * settled close after RTH, not the index snapshot's stale session.close).
 */

/** Same pct bands as scripts/audit/data-validator.mjs priceTol for SPX/SPY. */
export function spxOraclePriceTolerancePct(isRth) {
  return isRth ? 0.3 : 1.5;
}

export function spxOracleWithinTolerance(desk, oracle, isRth) {
  if (!(desk > 0 && oracle > 0)) return { ok: false, delta: null, pct: null, tol: spxOraclePriceTolerancePct(isRth) };
  const delta = Math.abs(desk - oracle);
  const pct = (delta / oracle) * 100;
  const tol = spxOraclePriceTolerancePct(isRth);
  return { ok: pct <= tol, delta, pct, tol };
}

/**
 * @returns {{ oracle: number, label: string } | null}
 */
export function pickSpxOracleFromPolygon({
  isRth,
  snapshotValue,
  snapshotSessionClose,
  todayDayClose,
  prevDayClose,
}) {
  if (isRth) {
    const oracle = Number(snapshotValue ?? snapshotSessionClose);
    return oracle > 0 ? { oracle, label: "live" } : null;
  }
  const todayClose = Number(todayDayClose);
  if (todayClose > 0) return { oracle: todayClose, label: "today-close" };
  const prevClose = Number(prevDayClose);
  if (prevClose > 0) return { oracle: prevClose, label: "prev-close" };
  const fallback = Number(snapshotValue ?? snapshotSessionClose);
  return fallback > 0 ? { oracle: fallback, label: "snapshot-fallback" } : null;
}
