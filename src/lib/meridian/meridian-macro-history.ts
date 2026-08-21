import "server-only";

import { priorScheduledMacroEvents } from "@/lib/providers/macro-events";
import { fetchBenzingaNews } from "@/lib/providers/polygon";
import { fetchUwEconomyIndicator } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import { spxReactionsForDates } from "@/lib/meridian/meridian-reaction";
import { macroIntradayReactions } from "@/lib/meridian/meridian-intraday-reaction";
import type { MeridianCatalystHeadline, MeridianMacroRelease } from "@/features/meridian/lib/meridian-types";

function macroIndicatorIdForEvent(event: string): string | null {
  const u = event.toUpperCase();
  if (u.includes("CPI")) return "CPI";
  if (u.includes("NFP") || u.includes("PAYROLL") || u.includes("NONFARM")) return "PAYROLLS";
  if (u.includes("GDP")) return "GDP";
  if (u.includes("UNEMPLOY")) return "UNRATE";
  if (u.includes("PCE")) return "PCE";
  if (u.includes("PPI")) return "PPI";
  return null;
}

function num(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(Number(v).toFixed(4));
  }
  return null;
}

function rowYmd(row: Record<string, unknown>): string {
  return String(
    row.date ?? row.as_of ?? row.period ?? row.release_date ?? row.period_date ?? ""
  ).slice(0, 10);
}

function benzingaChannelsForEvent(event: string): string {
  const u = event.toUpperCase();
  if (u.includes("FOMC") || u.includes("FED")) return "economics,fed";
  if (u.includes("CPI") || u.includes("PPI") || u.includes("PCE") || u.includes("GDP")) return "economics";
  return "economics";
}

function headlineFilter(event: string, title: string): boolean {
  const t = title.toLowerCase();
  const u = event.toLowerCase();
  if (u.includes("fomc") || u.includes("fed")) return /fomc|fed|rate decision|powell|interest rate/.test(t);
  if (u.includes("cpi")) return /\bcpi\b|consumer price|inflation print/.test(t);
  if (u.includes("payroll") || u.includes("nfp")) return /payroll|nonfarm|jobs report|employment/.test(t);
  return t.includes(u.slice(0, 4));
}

/** Prior macro prints with actual/estimate reads + SPX reaction + related headlines. */
export async function loadMeridianMacroHistory(input: {
  event: string;
  beforeYmd: string;
  releaseTimeEt?: string | null;
}): Promise<{
  release_history: MeridianMacroRelease[];
  related_headlines: MeridianCatalystHeadline[];
  economics_narrative: string | null;
}> {
  const prior = priorScheduledMacroEvents({
    event: input.event,
    beforeYmd: input.beforeYmd,
    limit: 6,
  });
  const dates = prior.map((p) => p.date);

  const indicatorId = macroIndicatorIdForEvent(input.event);
  const [reactions, intradayMap, indicator, news] = await Promise.all([
    spxReactionsForDates(dates),
    macroIntradayReactions(dates, input.releaseTimeEt ?? null),
    indicatorId
      ? fetchUwEconomyIndicator(indicatorId).catch(() => null)
      : Promise.resolve(null),
    fetchBenzingaNews(20, { channels: benzingaChannelsForEvent(input.event) }).catch(() => []),
  ]);

  const rowsByDate = new Map<string, Record<string, unknown>>();
  for (const row of indicator?.rows ?? []) {
    const ymd = rowYmd(row as Record<string, unknown>);
    if (ymd) rowsByDate.set(ymd, row as Record<string, unknown>);
  }

  const release_history: MeridianMacroRelease[] = prior.map((p) => {
    const row = rowsByDate.get(p.date);
    const rx = reactions.get(p.date);
    const actual = row ? num(row, "actual", "value", "release", "release_value") : null;
    const estimate = row ? num(row, "estimate", "forecast", "consensus") : null;
    const priorVal = row ? num(row, "prior", "previous", "prior_value") : null;
    return {
      date: p.date,
      label: p.event,
      actual,
      estimate,
      prior: priorVal,
      spx_session_pct: rx?.session_change_pct ?? null,
      spx_next_day_pct: rx?.next_day_change_pct ?? null,
      spx_intraday_60_pct: intradayMap.get(p.date) ?? null,
    };
  });

  const related_headlines = news
    .filter((n) => headlineFilter(input.event, n.title))
    .slice(0, 8)
    .map((n) => ({
      title: n.title,
      channel: n.channels?.[0] ?? "economics",
      published: n.published || null,
    }));

  const lead = news.find((n) => headlineFilter(input.event, n.title));
  const latestRx = release_history.find((r) => r.spx_session_pct != null);
  let economics_narrative: string | null = null;
  if (lead) {
    const prose = [lead.title, lead.teaser?.trim()].filter(Boolean).join(" — ");
    economics_narrative = prose.slice(0, 280) || null;
    if (latestRx?.spx_session_pct != null) {
      const spxPart = `SPX ${latestRx.spx_session_pct >= 0 ? "+" : ""}${latestRx.spx_session_pct.toFixed(1)}% on last ${input.event.split(" ")[0]} print`;
      economics_narrative = economics_narrative ? `${economics_narrative} · ${spxPart}` : spxPart;
    }
  } else if (latestRx?.spx_session_pct != null) {
    economics_narrative = `Last ${input.event} print · SPX ${latestRx.spx_session_pct >= 0 ? "+" : ""}${latestRx.spx_session_pct.toFixed(1)}% session`;
  }

  return roundFloats({ release_history, related_headlines, economics_narrative });
}
