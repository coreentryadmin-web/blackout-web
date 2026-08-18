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
import { recordMeridianReportSnapshot, readMeridianReportSnapshots } from "@/lib/db";
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
    // Sector coverage, forwarded so it is actually reachable. These counters existed on the lane
    // result but were never put on the payload, so the "coverage is a number, not an assumption"
    // guarantee was not true end-to-end — a consumer saw `undefined` and could not tell a fully
    // classified lane from one where every lookup had failed.
    sectors_classified: earningsBundle.sectors_classified,
    sectors_unclassified: earningsBundle.sectors_unclassified,
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
    const detail = roundFloats({ kind: "earnings" as const, pack, enrichment, intel });

    /**
     * Record today's read, so the desk can later say "bullish five days ago, neutral now".
     *
     * Written on the READ path rather than the warm cron on purpose. The warm cron is
     * weekdays + market-hours gated, so a cron-driven series would have holes exactly where an
     * earnings calendar is busiest — evenings and the run-up to a morning print. This costs
     * nothing extra (the report is already built) and naturally covers the names members
     * actually open.
     *
     * Fire-and-forget: a snapshot is an observation for a panel, not part of serving the page.
     * `void` + a caught rejection so a DB hiccup can never take the event detail down with it.
     */
    void recordMeridianReportSnapshot({
      ticker,
      eventDate: parsed.date,
      snapshotDay: todayEtYmd(),
      score: intel?.report?.score ?? null,
      verdict: intel?.report?.verdict ?? null,
      confidence: intel?.report?.confidence ?? null,
      pillars: Object.fromEntries(
        (intel?.report?.signals ?? [])
          .filter((sig) => sig?.pillar && sig?.lean)
          .map((sig) => [String(sig.pillar), String(sig.lean)])
      ),
    }).catch(() => {});

    // The day series this event has accumulated. Read AFTER the write above so today's own
    // observation is included — a drift panel that omitted the current read would compare the
    // reader against a past they can no longer see.
    const drift_snapshots = await readMeridianReportSnapshots(ticker, parsed.date, 30);
    return { ...detail, drift_snapshots };
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
