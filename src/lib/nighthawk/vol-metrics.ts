function sortRowsByDateDesc(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const da = String(a.date ?? a.as_of ?? a.timestamp ?? a.trading_date ?? "");
    const db = String(b.date ?? b.as_of ?? b.timestamp ?? b.trading_date ?? "");
    return db.localeCompare(da);
  });
}

function rowNumeric(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = Number(row[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

export function parseLatestRealizedVol(rows: Record<string, unknown>[]): number | null {
  const latest = sortRowsByDateDesc(rows)[0];
  if (!latest) return null;
  const val = rowNumeric(latest, [
    "realized_volatility",
    "realized_vol",
    "rv",
    "value",
    "volatility",
    "vol",
  ]);
  return val != null && val > 0 ? val : null;
}

/** UW historical risk-reversal skew — positive puts bid over calls (fear). */
export function parseLatestRiskReversalSkew(rows: Record<string, unknown>[]): number | null {
  const latest = sortRowsByDateDesc(rows)[0];
  if (!latest) return null;
  return rowNumeric(latest, ["skew", "risk_reversal_skew", "risk_reversal", "rr_skew", "value"]);
}
