/**
 * Drop data-integrity "GEX cold" issues when a live gex-heatmap read proves the matrix
 * is warm (same run, different code path — measured as a transient getGexPositioning miss).
 */

/**
 * @param {Array<{ title?: string, detail?: string }>} issues
 * @param {(path: string) => Promise<{ status: number, json?: { spot?: number } }>} fetchHeatmap
 */
export async function filterReconciledGexColdIssues(issues, fetchHeatmap) {
  if (!issues?.length) return { kept: [], reconciled: [] };
  const kept = [];
  const reconciled = [];
  for (const issue of issues) {
    const text = `${issue.title ?? ""} ${issue.detail ?? ""}`;
    const m = /getGexPositioning\("(SPX|SPY)"\)/i.exec(text);
    if (!m) {
      kept.push(issue);
      continue;
    }
    const ticker = m[1].toUpperCase();
    const { status, json } = await fetchHeatmap(ticker);
    if (status === 200 && Number(json?.spot) > 0) {
      reconciled.push({ ticker, issue });
      continue;
    }
    kept.push(issue);
  }
  return { kept, reconciled };
}
