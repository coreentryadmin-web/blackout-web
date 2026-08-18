import "server-only";

import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchUpcomingMacroEventsLive, macroEventsOnDateLive } from "@/lib/providers/macro-events";
import {
  loadMeridianEarningsTimeline,
  loadMeridianFdaTimeline,
} from "@/lib/meridian/meridian-timeline-server";
import { buildMeridianTimeline, parseMeridianEventId } from "@/features/meridian/lib/meridian-timeline";
import { roundFloats } from "@/lib/round-floats";
import { preEarningsPackForLargo } from "@/lib/largo/pre-earnings-pack";
import {
  buildMeridianMacroBrief,
  buildMeridianOpexDetail,
  buildMeridianFdaDetail,
  loadMeridianEarningsEnrichment,
} from "@/lib/meridian/meridian-event-brief";
import { loadMeridianEarningsIntel } from "@/lib/meridian/meridian-earnings-intel";
import { readMeridianBoardTickers } from "@/lib/meridian/meridian-board-tickers";
import type {
  MeridianEventDetail,
  MeridianTimelinePayload,
  MeridianTimelineStats,
} from "@/features/meridian/lib/meridian-types";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { prefetchSpxDeskEnrichment } from "@/features/spx/lib/spx-desk";

export const MERIDIAN_TIMELINE_TTL_MS = 120_000;
export const MERIDIAN_EVENT_TTL_MS = 120_000;

function buildTimelineStats(items: MeridianTimelinePayload["items"]): MeridianTimelineStats {
  return {
    total: items.length,
    macro: items.filter((i) => i.kind === "macro").length,
    earnings: items.filter((i) => i.kind === "earnings").length,
    fda: items.filter((i) => i.kind === "fda").length,
    opex: items.filter((i) => i.kind === "opex").length,
    high_impact: items.filter((i) => i.impact === "high").length,
    next_24h: items.filter((i) => i.days_until <= 1).length,
    earnings_mega_cap: items.filter((i) => i.kind === "earnings" && (i.importance ?? 0) >= 4).length,
  };
}

const DEFAULT_WARM_DAYS = 21;

/** Build the Meridian timeline payload (shared by API route + warm cron). */
export async function loadMeridianTimelineResponse(daysAhead: number): Promise<MeridianTimelinePayload> {
  const today = todayEtYmd();
  const board_tickers = await readMeridianBoardTickers();
  const [macro, earningsBundle, fdaRows] = await Promise.all([
    fetchUpcomingMacroEventsLive(daysAhead),
    loadMeridianEarningsTimeline(today, daysAhead, board_tickers),
    loadMeridianFdaTimeline(today, daysAhead),
  ]);

  const items = buildMeridianTimeline({
    todayYmd: today,
    daysAhead,
    macro: macro.map((m) => ({
      event: m.event,
      date: m.date ?? today,
      time: m.time,
      impact: m.impact,
      estimate: m.estimate ?? null,
    })),
    earnings: earningsBundle.rows,
    fda: fdaRows,
  });

  return roundFloats({
    as_of: new Date().toISOString(),
    days_ahead: daysAhead,
    items,
    stats: buildTimelineStats(items),
    board_tickers,
    earnings_week: earningsBundle.earnings_week,
    earnings_analytics_rows: earningsBundle.earnings_analytics_rows,
    earnings_week_analytics: earningsBundle.earnings_week_analytics,
    recent_earnings_revisions: earningsBundle.recent_revisions,
    estimate_revision_timeline: earningsBundle.estimate_revision_timeline,
    after_hours_movers: earningsBundle.after_hours_movers,
    earnings_calendar_entitled: earningsBundle.calendar_entitled,
    // Surfaced so the lane can SAY it filtered. A quietly shorter list is indistinguishable
    // from a quietly broken feed, and the two need different reactions from the reader.
    non_optionable_hidden: earningsBundle.non_optionable_hidden,
    optionable_filter_applied: earningsBundle.optionable_filter_applied,
  });
}

/** Build one event detail payload (shared by API route + warm cron). */
export async function loadMeridianEventResponse(id: string): Promise<MeridianEventDetail | null> {
  const parsed = parseMeridianEventId(id);
  if (!parsed) return null;

  if (parsed.kind === "earnings") {
    const ticker = parsed.ticker;
    if (!ticker) return null;
    const pack = await preEarningsPackForLargo(ticker, parsed.date);
    if (!pack) return null;
    const enrichment = await loadMeridianEarningsEnrichment(ticker, pack.expected_move_pct, parsed.date);
    const intel = await loadMeridianEarningsIntel({
      ticker,
      pack,
      print_history: enrichment.print_history,
      enrichment,
    });
    return roundFloats({ kind: "earnings", pack, enrichment, intel });
  }

  if (parsed.kind === "fda") {
    const ticker = parsed.ticker;
    if (!ticker) return null;
    return buildMeridianFdaDetail({ ticker, date: parsed.date });
  }

  if (parsed.kind === "opex") {
    return buildMeridianOpexDetail(parsed.date);
  }

  const rows = await macroEventsOnDateLive(parsed.date);
  const slug = parsed.slug?.replace(/-/g, " ") ?? "";
  const match =
    rows.find((r) => r.event.toLowerCase() === slug.toLowerCase()) ??
    rows.find((r) => slug && r.event.toLowerCase().includes(slug.toLowerCase())) ??
    rows[0];
  if (!match) return null;

  return buildMeridianMacroBrief({
    event: match.event,
    date: parsed.date,
    time: match.time?.trim() || null,
    impact: match.impact === "high" ? "high" : match.impact === "medium" ? "medium" : "low",
    estimate: match.estimate ?? null,
  });
}

/** Pre-warm shared caches Meridian reads (Polygon GEX + desk enrichment + timeline). */
export async function warmMeridianCaches(daysAhead = DEFAULT_WARM_DAYS): Promise<{
  timeline_ok: boolean;
  gex_ok: boolean;
  desk_ok: boolean;
}> {
  const [timelineResult, gexResult, deskResult] = await Promise.allSettled([
    loadMeridianTimelineResponse(daysAhead),
    fetchGexHeatmap("SPX"),
    prefetchSpxDeskEnrichment(),
  ]);

  return {
    timeline_ok: timelineResult.status === "fulfilled",
    gex_ok: gexResult.status === "fulfilled" && gexResult.value != null,
    desk_ok: deskResult.status === "fulfilled",
  };
}
