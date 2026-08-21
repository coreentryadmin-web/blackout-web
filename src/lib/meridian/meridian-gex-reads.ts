import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import type { GreekExposureSummary } from "@/lib/greek-exposure-summary";

/**
 * Max pain for one expiry from the shared Polygon GEX heatmap cache — **that expiry only**,
 * with no whole-book fallback.
 *
 * Use this for any DATED row (a past OpEx, a historical print). The current chain has no
 * strikes for an expiry that already passed, so `max_pain_by_expiry` will not carry it, and
 * falling back to the book's overall max pain stamps TODAY's number onto that date as though
 * it had been measured then. That is not a degraded value — it is a different quantity wearing
 * the row's date, which is precisely the defect FINDINGS 2026-08-18 ("dealer structure from the
 * WRONG EXPIRY for dated events") already cost us once.
 */
export function maxPainForExpiryStrict(
  hm: GexHeatmap | null | undefined,
  expiryYmd: string
): number | null {
  if (!hm || !expiryYmd) return null;
  const scoped = hm.max_pain_by_expiry?.[expiryYmd];
  return scoped != null && Number.isFinite(scoped) && scoped > 0 ? scoped : null;
}

/**
 * Max pain for one expiry, falling back to the book's overall max pain when that expiry is not
 * broken out.
 *
 * The fallback is only defensible for the CURRENT/UPCOMING event, where "the book's max pain"
 * and "this expiry's max pain" describe the same live chain. For a historical date use
 * `maxPainForExpiryStrict` instead — see the note there.
 */
export function maxPainForExpiryFromHeatmap(
  hm: GexHeatmap | null | undefined,
  expiryYmd: string
): number | null {
  // Guard BEFORE the fallback, not just inside the strict lookup: a blank expiry is a caller
  // bug, and answering it with the book-wide number would invent an attribution to no date at
  // all. (The pre-refactor code returned null here; this keeps it byte-identical.)
  if (!hm || !expiryYmd) return null;
  const scoped = maxPainForExpiryStrict(hm, expiryYmd);
  if (scoped != null) return scoped;
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
