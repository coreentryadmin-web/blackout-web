import "server-only";

import { fetchBenzingaCatalysts, fetchBenzingaEarnings } from "@/lib/providers/polygon";
import { roundFloats } from "@/lib/round-floats";
import { loadMeridianEarningsPrintHistory } from "@/lib/meridian/meridian-earnings-history";
import { loadMeridianCatalystBundle } from "@/lib/meridian/meridian-catalyst-enrich";
import { buildExpectedVsRealized } from "@/lib/meridian/meridian-analytics-core";
import {
  computeEarningsYoY,
  dualBeatRateFromPrints,
  guidanceToMeridianRow,
  mergeStreetEstimates,
  pickEarningsCalendarRow,
  postPrintSurpriseLean,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import {
  loadBenzingaTickerEarnings,
  loadBenzingaTickerGuidance,
  loadTickerEstimateRevisions,
} from "@/lib/meridian/meridian-benzinga-earnings";
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


/** Benzinga calendar + headlines + street estimates + print history for an earnings row. */
export async function loadMeridianEarningsEnrichment(
  ticker: string,
  expectedMovePct?: number | null,
  eventDate?: string | null
): Promise<MeridianEarningsEnrichment> {
  const sym = ticker.trim().toUpperCase();
  const [catalysts, earningsNews, history, catalystBundle, benzingaRes, guidanceRes] =
    await Promise.all([
      fetchBenzingaCatalysts(sym, 6).catch(() => []),
      fetchBenzingaEarnings(sym, 6).catch(() => []),
      loadMeridianEarningsPrintHistory(sym, 8, eventDate),
      loadMeridianCatalystBundle(sym),
      loadBenzingaTickerEarnings(sym, eventDate ?? null),
      loadBenzingaTickerGuidance(sym),
    ]);

  const benzingaRows = benzingaRes.rows;
  const street_estimates = mergeStreetEstimates(benzingaRows, []);
  const earnings_calendar = pickEarningsCalendarRow(benzingaRows, eventDate);
  const earnings_yoy = earnings_calendar ? computeEarningsYoY(earnings_calendar) : null;
  const post_print = postPrintSurpriseLean(earnings_calendar);
  const beat_rates = dualBeatRateFromPrints(history.print_history);

  const lastPrint = history.print_history[0];
  const expected_vs_realized = buildExpectedVsRealized(
    expectedMovePct ?? null,
    lastPrint?.session_change_pct ?? null
  );

  const guidanceRow = guidanceRes.rows[0] ? guidanceToMeridianRow(guidanceRes.rows[0]) : null;
  const estimate_revisions = await loadTickerEstimateRevisions(sym, benzingaRows);

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
    earnings_yoy,
    corporate_guidance: guidanceRow,
    guidance_entitled: guidanceRes.entitled,
    post_print: post_print.headline ? post_print : null,
    print_history: history.print_history,
    print_history_summary: history.print_history_summary,
    beat_rates,
    analyst_revisions: catalystBundle.analyst_revisions,
    price_targets: catalystBundle.price_targets,
    street_skew: catalystBundle.street_skew,
    estimate_revisions,
    catalyst_briefs: catalystBundle.catalyst_briefs,
    insider_activity: catalystBundle.insider_activity,
    congress_trades: catalystBundle.congress_trades,
    expected_vs_realized,
  });
}
