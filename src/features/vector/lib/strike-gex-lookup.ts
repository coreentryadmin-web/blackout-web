/**
 * Shared strike → net GEX lookup for Vector pick ranking/evidence (client-safe).
 */
export function strikeGexFromTotals(
  totals: Record<string, number> | null | undefined,
  strike: number
): number | null {
  if (!(strike > 0) || !totals) return null;
  const candidates = [
    String(strike),
    strike.toFixed(1),
    strike.toFixed(2),
    String(Math.round(strike)),
  ];
  for (const k of candidates) {
    const v = totals[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function topGexPinStrikes(
  totals: Record<string, number> | null | undefined,
  limit = 5
): number[] {
  if (!totals) return [];
  const rows: Array<{ strike: number; abs: number }> = [];
  for (const [k, v] of Object.entries(totals)) {
    const strike = Number(k);
    if (!Number.isFinite(strike) || !Number.isFinite(v)) continue;
    rows.push({ strike, abs: Math.abs(v) });
  }
  rows.sort((a, b) => b.abs - a.abs);
  return rows.slice(0, limit).map((r) => r.strike);
}
