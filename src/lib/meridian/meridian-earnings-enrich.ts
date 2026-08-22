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
import { meridianFeedText, meridianFeedTextOrNull } from "@/lib/meridian/meridian-feed-text";
import type { MeridianEarningsEnrichment } from "@/features/meridian/lib/meridian-types";

function shapeHeadlines(
  rows: Array<{ title?: string; channel?: string; published?: string; type?: string }>
): MeridianEarningsEnrichment["catalysts"] {
  return rows
    // Decoded first, then filtered: a title that is only entities and whitespace is not a headline.
    .map((r) => ({ ...r, title: meridianFeedText(r.title) }))
    .filter((r) => r.title.length > 0)
    .slice(0, 6)
    .map((r) => ({
      title: r.title,
      channel: meridianFeedTextOrNull(r.channel) ?? meridianFeedTextOrNull(r.type),
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
      // 8 to match the print-history call above, so both read the same window.
      loadBenzingaTickerEarnings(sym, eventDate ?? null, 8),
      loadBenzingaTickerGuidance(sym),
    ]);

  const benzingaRows = benzingaRes.rows;
  const street_estimates = mergeStreetEstimates(benzingaRows, []);
  const earnings_calendar = pickEarningsCalendarRow(benzingaRows, eventDate);
  const earnings_yoy = earnings_calendar ? computeEarningsYoY(earnings_calendar) : null;
  const post_print = postPrintSurpriseLean(earnings_calendar);
  const beat_rates = dualBeatRateFromPrints(history.print_history);

  const lastPrint = history.print_history[0];
  // Compare the last print's reaction against the implied move CAPTURED FOR THAT PRINT, never
  // against today's live quote — see buildExpectedVsRealized. `print_history[].expected_move_pct`
  // is the field for it; when it is absent (today: 0 of 8 rows) the reaction is published without
  // a ratio rather than compared to whatever number is to hand. Passing it this way means the
  // card starts working the moment that field is populated, with no further change here.
  const priorImplied = lastPrint?.expected_move_pct ?? null;
  const expected_vs_realized = buildExpectedVsRealized(
    // Only the per-print implied. The pack's live chain-IV move is NOT a fallback here: it belongs
    // to a different print, and passing it made the block carry a number a consumer then paired.
    priorImplied,
    // The REACTION, not the anchor session's open→close. A post-close print reprices on the next
    // session, so `session_change_pct` alone drops the overnight gap that carries the move — INTU's
    // last print reads -1.67% by session and -20.02% by reaction. `reaction_pct` is the like-for-
    // like quantity, and it is what `patchMeridianEnrichmentExpectedMove` already uses; this path
    // is served whenever that patch early-returns for want of a chain-IV move.
    lastPrint?.reaction_pct ?? lastPrint?.session_change_pct ?? null,
    priorImplied != null
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
    guidance_on_file: guidanceRow != null,
    post_print: post_print.headline ? post_print : null,
    print_history: history.print_history,
    print_history_summary: history.print_history_summary,
    // An outage must be distinguishable from an empty company. Without this, every panel fed
    // from the Benzinga calendar renders blank and the reader concludes the data does not
    // exist — measured on 8/8 mega-caps on 2026-08-18.
    calendar_error: history.history_error ?? (benzingaRes as { error?: string | null }).error ?? null,
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
