/**
 * PURE per-ticker greek-flow summarizer, split out of dossier.ts (which transitively imports
 * `server-only` providers) so it is unit-testable with a plain `tsx --test` run — importing
 * dossier.ts directly throws ("cannot be imported from a Client Component"). dossier.ts
 * re-exports both the type and the function so its public surface is unchanged.
 */

export type TickerGreekFlowSummary = {
  net_delta: number;
  /** null when this data source carries no gamma field at all — never a fabricated 0. See
   * src/lib/group-greek-flow-summary.ts's numPresent() doc comment for why. */
  net_gamma: number | null;
  bias: "bullish" | "bearish" | "neutral";
  row_count: number;
};

function gfNum(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function gfNumPresent(row: Record<string, unknown>, ...keys: string[]): { value: number; present: boolean } {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return { value: Number(v), present: true };
  }
  return { value: 0, present: false };
}

export function summarizeTickerGreekFlow(
  rows: Record<string, unknown>[]
): TickerGreekFlowSummary | null {
  if (!rows.length) return null;
  let netDelta = 0;
  let netGamma = 0;
  let gammaPresent = false;
  for (const r of rows) {
    // dir_delta_flow is UW's real signed net-delta field on /api/stock/{ticker}/greek-flow —
    // confirmed live 2026-09-02 (same shape as the group-flow endpoint fixed alongside this).
    // net_delta/delta/net_deltas kept first for any other caller/fixture already using those names.
    const d = gfNum(r, "net_delta", "delta", "net_deltas", "dir_delta_flow");
    const cd = gfNum(r, "call_delta", "call_deltas");
    const pd = gfNum(r, "put_delta", "put_deltas");
    netDelta += d !== 0 ? d : cd + pd;
    const gammaRead = gfNumPresent(r, "net_gamma", "gamma", "net_gex", "gex");
    if (gammaRead.present) {
      gammaPresent = true;
      netGamma += gammaRead.value;
    }
  }
  const netGammaResult: number | null = gammaPresent ? netGamma : null;
  if (netDelta === 0 && netGammaResult === null) return null;
  const bias: TickerGreekFlowSummary["bias"] =
    netDelta > 10_000 ? "bullish" : netDelta < -10_000 ? "bearish" : "neutral";
  return { net_delta: netDelta, net_gamma: netGammaResult, bias, row_count: rows.length };
}
