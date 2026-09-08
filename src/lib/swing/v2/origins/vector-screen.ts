/**
 * VECTOR Tier-0 origin (Swing Engine V2 P3/O6) — pure helpers.
 */

/** Pure: leader rows → deduped tickers (rank order preserved). */
export function vectorTickersFromLeaderRows(
  rows: ReadonlyArray<{ ticker?: string | null }>,
  limit = 80,
): string[] {
  const cap = Math.max(1, Math.min(limit, 120));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const t = String(row.ticker ?? "").trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}
