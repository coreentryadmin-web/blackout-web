import "server-only";

import { fetchBenzingaCatalysts, fetchBenzingaEarnings } from "@/lib/providers/polygon";
import { fetchUwEarningsEstimates } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import type { MeridianEarningsEnrichment } from "@/features/meridian/lib/meridian-types";

function shapeHeadlines(
  rows: Array<{ title?: string; channel?: string; published?: string; type?: string }>
): MeridianEarningsEnrichment["catalysts"] {
  return rows
    .filter((r) => r.title?.trim())
    .slice(0, 6)
    .map((r) => ({
      title: String(r.title).trim(),
      channel: r.channel?.trim() || r.type?.trim() || null,
      published: r.published?.trim() || null,
    }));
}

function shapeEstimates(rows: Record<string, unknown>[]): MeridianEarningsEnrichment["street_estimates"] {
  return rows.slice(0, 4).map((r) => {
    const eps = r.eps_estimate ?? r.estimated_eps ?? r.street_mean_est ?? r.eps ?? null;
    const rev = r.revenue_estimate ?? r.estimated_revenue ?? r.revenue ?? null;
    const period = String(r.fiscal_date ?? r.period ?? r.quarter ?? r.report_date ?? "").trim() || null;
    return {
      period,
      eps_estimate: eps != null && Number.isFinite(Number(eps)) ? Number(Number(eps).toFixed(2)) : null,
      revenue_estimate:
        rev != null && Number.isFinite(Number(rev)) ? Number(Number(rev).toFixed(0)) : null,
    };
  });
}

/** Benzinga catalysts + earnings headlines + street estimates for an earnings row. */
export async function loadMeridianEarningsEnrichment(ticker: string): Promise<MeridianEarningsEnrichment> {
  const sym = ticker.trim().toUpperCase();
  const [catalysts, earningsNews, estimateRows] = await Promise.all([
    fetchBenzingaCatalysts(sym, 6).catch(() => []),
    fetchBenzingaEarnings(sym, 6).catch(() => []),
    fetchUwEarningsEstimates(sym).catch(() => [] as Record<string, unknown>[]),
  ]);

  return roundFloats({
    catalysts: shapeHeadlines(
      catalysts.map((c) => ({
        title: c.title,
        channel: c.channel ?? c.type,
        published: c.published,
        type: c.type,
      }))
    ),
    earnings_headlines: shapeHeadlines(
      earningsNews.map((c) => ({
        title: c.title,
        channel: c.channels?.[0] ?? "earnings",
        published: c.published,
      }))
    ),
    street_estimates: shapeEstimates(estimateRows),
  });
}
