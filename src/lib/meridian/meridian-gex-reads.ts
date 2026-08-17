import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import type { GreekExposureSummary } from "@/lib/greek-exposure-summary";

/** Max pain for one expiry from the shared Polygon GEX heatmap cache — no UW REST. */
export function maxPainForExpiryFromHeatmap(
  hm: GexHeatmap | null | undefined,
  expiryYmd: string
): number | null {
  if (!hm || !expiryYmd) return null;
  const scoped = hm.max_pain_by_expiry?.[expiryYmd];
  if (scoped != null && Number.isFinite(scoped) && scoped > 0) return scoped;
  if (hm.max_pain != null && Number.isFinite(hm.max_pain) && hm.max_pain > 0) return hm.max_pain;
  return null;
}

/**
 * Dealer gamma concentration by expiry from Polygon matrix cells — same question as UW
 * greek-exposure/expiry, but derived from the shared heatmap cache (zero extra upstream).
 */
export function summarizeHeatmapGammaByExpiry(
  cells: Record<string, Record<string, number>> | null | undefined,
  todayYmd: string
): GreekExposureSummary | null {
  if (!cells || !Object.keys(cells).length) return null;

  const byExpiry = new Map<string, number>();
  for (const byStrike of Object.values(cells)) {
    for (const [expiry, gamma] of Object.entries(byStrike)) {
      const g = Number(gamma);
      if (!Number.isFinite(g) || g === 0) continue;
      byExpiry.set(expiry, (byExpiry.get(expiry) ?? 0) + Math.abs(g));
    }
  }
  if (!byExpiry.size) return null;

  const total = Array.from(byExpiry.values()).reduce((s, v) => s + v, 0);
  if (total <= 0) return null;

  const buckets = Array.from(byExpiry.entries())
    .map(([expiry, gamma]) => {
      const pct = (gamma / total) * 100;
      return {
        expiry,
        gamma,
        pct_of_total: Number(pct.toFixed(1)),
        dte_label: expiry === todayYmd ? "0DTE" : expiry,
      };
    })
    .sort((a, b) => b.gamma - a.gamma);

  const top = buckets[0]!;
  const headline =
    top.expiry === todayYmd
      ? `0DTE is ${top.pct_of_total.toFixed(0)}% of dealer gamma today`
      : `${top.dte_label} pins ${top.pct_of_total.toFixed(0)}% of dealer gamma`;

  return {
    buckets: buckets.slice(0, 8),
    pinned_expiry: top.expiry,
    pinned_pct: top.pct_of_total,
    total_gamma: total,
    headline,
  };
}
