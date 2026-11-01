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
  // Strongest first; an EXACT |gex| tie breaks on strike ascending (lower strike wins) so the
  // result never depends on `Object.entries(totals)` insertion order. Non-integer (half-strike)
  // keys preserve true insertion order in JS, and `strike_totals` is built with two different
  // insertion orders in this codebase (polygon-options-gex.ts's primary chain path inserts
  // strike-descending; its UW-spot-exposures fallback path inserts in raw upstream row order) —
  // without this secondary key, two sessions with the identical tied book could rank oppositely
  // purely because of which upstream fed the heatmap. Same convention as kingFromStrikeTotals /
  // wallsFromStrikeTotals in gex-cross-validation-core.ts.
  rows.sort((a, b) => (b.abs !== a.abs ? b.abs - a.abs : a.strike - b.strike));
  return rows.slice(0, limit).map((r) => r.strike);
}
