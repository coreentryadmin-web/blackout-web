import "server-only";

import { fetchBenzingaCatalysts, fetchBenzingaEarnings } from "@/lib/providers/polygon";
import { fetchUwEarningsEstimates } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import { loadMeridianEarningsPrintHistory } from "@/lib/meridian/meridian-earnings-history";
import { loadMeridianCatalystBundle } from "@/lib/meridian/meridian-catalyst-enrich";
import { buildExpectedVsRealized } from "@/lib/meridian/meridian-analytics-core";
import {
  mergeStreetEstimates,
  pickEarningsCalendarRow,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import { loadBenzingaTickerEarnings } from "@/lib/meridian/meridian-benzinga-earnings";
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
      source: "uw" as const,
    };
  });
}

/** Benzinga catalysts + earnings headlines + street estimates + print history for an earnings row. */
export async function loadMeridianEarningsEnrichment(
  ticker: string,
  expectedMovePct?: number | null,
  eventDate?: string | null
): Promise<MeridianEarningsEnrichment> {
  const sym = ticker.trim().toUpperCase();
  const [catalysts, earningsNews, estimateRows, history, catalystBundle, benzingaRows] = await Promise.all([
    fetchBenzingaCatalysts(sym, 6).catch(() => []),
    fetchBenzingaEarnings(sym, 6).catch(() => []),
    fetchUwEarningsEstimates(sym).catch(() => [] as Record<string, unknown>[]),
    loadMeridianEarningsPrintHistory(sym, 6),
    loadMeridianCatalystBundle(sym),
    loadBenzingaTickerEarnings(sym, eventDate ?? null),
  ]);

  const uwEstimates = shapeEstimates(estimateRows);
  const street_estimates = mergeStreetEstimates(benzingaRows, uwEstimates);
  const earnings_calendar = pickEarningsCalendarRow(benzingaRows, eventDate);

  const lastPrint = history.print_history[0];
  const expected_vs_realized = buildExpectedVsRealized(
    expectedMovePct ?? null,
    lastPrint?.session_change_pct ?? null
  );

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
    street_estimates,
    earnings_calendar,
    print_history: history.print_history,
    print_history_summary: history.print_history_summary,
    analyst_revisions: catalystBundle.analyst_revisions,
    insider_activity: catalystBundle.insider_activity,
    congress_trades: catalystBundle.congress_trades,
    expected_vs_realized,
  });
}
