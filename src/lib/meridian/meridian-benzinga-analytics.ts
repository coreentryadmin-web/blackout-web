import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";
import type { BenzingaPriceTarget } from "@/lib/providers/polygon";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import {
  benzingaRowsToPrintHistory,
  benzingaSurpriseToDisplayPct,
  dualBeatRateFromPrints,
  revisionHeadline,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import type {
  MeridianEarningsWeekAnalytics,
  MeridianEarningsWeekRow,
  MeridianEstimateRevisionEntry,
  MeridianStreetSkew,
} from "@/features/meridian/lib/meridian-types";

const SNAP_PREFIX = "meridian:est-snap:v1:";
const SNAP_TTL_SEC = 14 * 24 * 3600;

type EstimateSnap = {
  date: string;
  date_status: string | null;
  estimated_eps: number | null;
  estimated_revenue: number | null;
  actual_eps: number | null;
  actual_revenue: number | null;
};

function snapFromRow(row: BenzingaStructuredEarnings): EstimateSnap {
  return {
    date: row.date,
    date_status: row.date_status,
    estimated_eps: row.estimated_eps,
    estimated_revenue: row.estimated_revenue,
    actual_eps: row.actual_eps,
    actual_revenue: row.actual_revenue,
  };
}

function revisionEntry(
  row: BenzingaStructuredEarnings,
  change_kind: MeridianEstimateRevisionEntry["change_kind"],
  extras: Partial<MeridianEstimateRevisionEntry> = {}
): MeridianEstimateRevisionEntry {
  return {
    ticker: row.ticker,
    company_name: row.company_name,
    date: row.date,
    last_updated: row.last_updated ?? new Date().toISOString(),
    change_kind,
    eps_delta: null,
    revenue_delta_pct: null,
    estimated_eps: row.estimated_eps,
    estimated_revenue: row.estimated_revenue,
    headline: extras.headline ?? revisionHeadline(row),
    ...extras,
  };
}

/**
 * Diff current Benzinga rows against Redis snapshots — surfaces real EPS/revenue/date deltas.
 * First sighting seeds the snapshot without emitting a revision row.
 */
export async function diffEstimateRevisionTimeline(
  rows: BenzingaStructuredEarnings[],
  sinceIso: string
): Promise<MeridianEstimateRevisionEntry[]> {
  const sinceMs = Date.parse(sinceIso);
  const out: MeridianEstimateRevisionEntry[] = [];

  for (const row of rows) {
    if (!row.last_updated || Date.parse(row.last_updated) < sinceMs) continue;
    const key = `${SNAP_PREFIX}${row.ticker}:${row.date}`;
    const prev = await sharedCacheGet<EstimateSnap>(key);
    const next = snapFromRow(row);

    if (!prev) {
      await sharedCacheSet(key, next, SNAP_TTL_SEC);
      if (row.actual_eps != null || row.actual_revenue != null) {
        out.push(revisionEntry(row, "print"));
      }
      continue;
    }

    let changed = false;

    if (row.actual_eps != null && prev.actual_eps == null) {
      out.push(revisionEntry(row, "print"));
      changed = true;
    }

    if (prev.date_status !== row.date_status && row.date_status) {
      out.push(
        revisionEntry(row, "date_status", {
          headline: `${row.ticker} date ${row.date_status} · ${row.date}`,
        })
      );
      changed = true;
    }

    if (
      row.estimated_eps != null &&
      prev.estimated_eps != null &&
      row.estimated_eps !== prev.estimated_eps
    ) {
      const eps_delta = Number((row.estimated_eps - prev.estimated_eps).toFixed(3));
      out.push(
        revisionEntry(row, "eps", {
          eps_delta,
          headline: `${row.ticker} EPS est ${prev.estimated_eps} → ${row.estimated_eps}`,
        })
      );
      changed = true;
    } else if (row.estimated_eps != null && prev.estimated_eps == null && row.actual_eps == null) {
      out.push(revisionEntry(row, "eps", { headline: `${row.ticker} EPS est set · ${row.estimated_eps}` }));
      changed = true;
    }

    if (
      row.estimated_revenue != null &&
      prev.estimated_revenue != null &&
      prev.estimated_revenue !== 0 &&
      row.estimated_revenue !== prev.estimated_revenue &&
      Number.isFinite(row.estimated_revenue) &&
      Number.isFinite(prev.estimated_revenue)
    ) {
      const revenue_delta_pct = Number(
        (((row.estimated_revenue - prev.estimated_revenue) / Math.abs(prev.estimated_revenue)) * 100).toFixed(1)
      );
      out.push(
        revisionEntry(row, "revenue", {
          revenue_delta_pct,
          headline: `${row.ticker} Rev est revised ${revenue_delta_pct >= 0 ? "+" : ""}${revenue_delta_pct}%`,
        })
      );
      changed = true;
    }

    if (changed || row.last_updated) {
      await sharedCacheSet(key, next, SNAP_TTL_SEC);
    }
  }

  return out
    .sort((a, b) => b.last_updated.localeCompare(a.last_updated))
    .slice(0, 24);
}

/** Aggregate beat/surprise stats for the mega-cap earnings week grid. */
export function buildEarningsWeekAnalytics(
  weekRows: MeridianEarningsWeekRow[],
  historicalRows: BenzingaStructuredEarnings[]
): MeridianEarningsWeekAnalytics | null {
  if (!weekRows.length) return null;
  const tickers = new Set(weekRows.map((r) => r.ticker.toUpperCase()));
  const prints = benzingaRowsToPrintHistory(
    historicalRows.filter((r) => tickers.has(r.ticker.toUpperCase())),
    40
  );
  if (!prints.length) {
    return {
      names_count: weekRows.length,
      printed_this_week: weekRows.filter((r) => r.is_printed).length,
      eps_beat_rate: null,
      revenue_beat_rate: null,
      eps_graded: 0,
      revenue_graded: 0,
      avg_surprise_pct: null,
      median_surprise_pct: null,
      headline: `${weekRows.length} mega-cap names this window`,
    };
  }

  const rates = dualBeatRateFromPrints(prints);
  const surprises = prints
    .map((p) => p.surprise_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const sorted = [...surprises].sort((a, b) => a - b);
  const avg =
    surprises.length > 0 ? surprises.reduce((a, b) => a + b, 0) / surprises.length : null;
  const median =
    sorted.length > 0
      ? sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
      : null;

  const beatPct =
    rates.eps_beat_rate != null ? Math.round(rates.eps_beat_rate * 100) : null;
  const headline =
    beatPct != null && avg != null
      ? `Universe ${beatPct}% EPS beat of ${rates.eps_graded} prints · avg surprise ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`
      : `${weekRows.length} mega-cap names · ${prints.length} historical prints`;

  return {
    names_count: weekRows.length,
    printed_this_week: weekRows.filter((r) => r.is_printed).length,
    eps_beat_rate: rates.eps_beat_rate,
    revenue_beat_rate: rates.revenue_beat_rate,
    // The universe rate is a share of the historical prints we could grade, not of the names in
    // the window — `names_count` is NOT its denominator, and a reader with only those two numbers
    // beside each other would reasonably assume it was.
    eps_graded: rates.eps_graded,
    revenue_graded: rates.revenue_graded,
    avg_surprise_pct: avg != null ? Number(avg.toFixed(1)) : null,
    median_surprise_pct: median != null ? Number(median.toFixed(1)) : null,
    headline,
  };
}

/** Honest street skew from recent parsed price-target articles (news-derived, not a fabricated consensus). */
export function buildStreetSkewFromPriceTargets(
  targets: BenzingaPriceTarget[]
): MeridianStreetSkew | null {
  if (!targets.length) return null;
  let raised = 0;
  let lowered = 0;
  let initiated = 0;
  for (const t of targets) {
    if (t.action === "raised") raised += 1;
    else if (t.action === "lowered") lowered += 1;
    else if (t.action === "initiated" || t.action === "set") initiated += 1;
  }
  const net = raised - lowered;
  const skew: MeridianStreetSkew["skew"] =
    net >= 2 ? "bullish" : net <= -2 ? "bearish" : "neutral";
  const headline =
    raised + lowered + initiated === 0
      ? `${targets.length} recent PT articles`
      : `${raised} raised · ${lowered} lowered${initiated ? ` · ${initiated} new` : ""}`;
  return {
    skew,
    raised_count: raised,
    lowered_count: lowered,
    initiated_count: initiated,
    sample_size: targets.length,
    headline,
    latest_target: targets[0]?.price_target ?? null,
    latest_firm: targets[0]?.firm ?? null,
  };
}

/** Summarize recent Benzinga surprise distribution for printed rows in-window. */
export function surpriseDistributionFromRows(
  rows: BenzingaStructuredEarnings[]
): { beat_count: number; miss_count: number; avg_eps_surprise_pct: number | null } {
  let beat = 0;
  let miss = 0;
  const surps: number[] = [];
  for (const r of rows) {
    if (r.actual_eps == null) continue;
    const s = benzingaSurpriseToDisplayPct(r.eps_surprise_pct);
    if (s != null) {
      surps.push(s);
      if (s >= 0) beat += 1;
      else miss += 1;
    } else if (r.eps_surprise != null) {
      if (r.eps_surprise >= 0) beat += 1;
      else miss += 1;
    }
  }
  const avg =
    surps.length > 0 ? Number((surps.reduce((a, b) => a + b, 0) / surps.length).toFixed(1)) : null;
  return { beat_count: beat, miss_count: miss, avg_eps_surprise_pct: avg };
}
