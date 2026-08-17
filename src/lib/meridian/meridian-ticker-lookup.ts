import "server-only";

import { daysUntilEt } from "@/features/meridian/lib/meridian-timeline";
import { isTickerLikeQuery, normalizeMeridianSearchQuery } from "@/features/meridian/lib/meridian-search-core";
import type { MeridianTickerLookup } from "@/features/meridian/lib/meridian-types";
import { fetchBenzingaStructuredEarnings } from "@/lib/providers/polygon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { serverCache } from "@/lib/server-cache";
import { roundFloats } from "@/lib/round-floats";

const LOOKUP_TTL_MS = 10 * 60 * 1000;

function whenFromTime(time: string | null): "premarket" | "afterhours" | null {
  if (!time) return null;
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return "premarket";
  return "afterhours";
}

/** Next upcoming earnings for a ticker — structured Benzinga v1, cached per ticker. */
export async function loadMeridianTickerLookup(
  rawTicker: string,
  timelineIds: readonly string[] = []
): Promise<MeridianTickerLookup> {
  const ticker = normalizeMeridianSearchQuery(rawTicker);
  if (!isTickerLikeQuery(ticker)) {
    return {
      ticker,
      found: false,
      in_timeline: false,
      earnings: null,
      timeline_id: null,
      message: "Enter a valid ticker symbol (1–5 letters).",
    };
  }

  const today = todayEtYmd();
  const rows = await serverCache(`meridian:lookup:earnings:${ticker}:${today}`, LOOKUP_TTL_MS, async () => {
    const res = await fetchBenzingaStructuredEarnings({ ticker, dateGte: today, limit: 5 });
    return res.rows;
  });

  const upcoming = rows.find((r) => r.date >= today && r.actual_eps == null) ?? rows[0] ?? null;
  const timeline_id = upcoming ? `earnings:${ticker}:${upcoming.date}` : null;
  const in_timeline = timeline_id ? timelineIds.includes(timeline_id) : false;

  if (!upcoming) {
    return {
      ticker,
      found: false,
      in_timeline: false,
      earnings: null,
      timeline_id: null,
      message: `No upcoming earnings found for ${ticker} in the next few months.`,
    };
  }

  const days_until = daysUntilEt(upcoming.date, today);
  const status =
    upcoming.date_status === "confirmed"
      ? "Confirmed date"
      : upcoming.date_status === "projected"
        ? "Projected date"
        : null;

  return roundFloats({
    ticker,
    found: true,
    in_timeline,
    earnings: {
      date: upcoming.date,
      time: upcoming.time,
      company_name: upcoming.company_name,
      date_status: upcoming.date_status,
      estimated_eps: upcoming.estimated_eps,
      fiscal_period: upcoming.fiscal_period,
      fiscal_year: upcoming.fiscal_year,
      days_until,
      when: whenFromTime(upcoming.time),
      status_label: status,
    },
    timeline_id,
    message: in_timeline
      ? `${ticker} earnings is on the timeline (${upcoming.date}).`
      : `${ticker} reports ${upcoming.date}${status ? ` · ${status}` : ""} — outside the current lane window.`,
  });
}
