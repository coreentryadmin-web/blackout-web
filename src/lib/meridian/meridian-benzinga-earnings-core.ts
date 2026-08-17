import type {
  BenzingaCorporateGuidance,
  BenzingaStructuredEarnings,
} from "@/lib/providers/polygon";
import { daysBetweenYmd, type NextEarnings } from "@/lib/providers/uw-earnings";
import type {
  MeridianEarningsCalendarRow,
  MeridianEarningsGuidanceRow,
  MeridianEarningsPrint,
  MeridianEarningsRevision,
  MeridianEarningsWeekRow,
  MeridianEarningsYoY,
  MeridianImpact,
  MeridianStreetEstimate,
} from "@/features/meridian/lib/meridian-types";
import type { EarningsTimelineInput } from "@/features/meridian/lib/meridian-timeline";

/** Benzinga surprise fields are ratios (0.0625 = 6.25%). Normalize to display percent. */
export function benzingaSurpriseToDisplayPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Number(raw);
  if (Math.abs(n) <= 1.5) return Number((n * 100).toFixed(1));
  return Number(n.toFixed(1));
}

/** Map Benzinga HH:MM:SS → premarket / afterhours bucket for timeline chips. */
export function earningsWhenFromTime(time: string | null): "premarket" | "afterhours" | null {
  if (!time) return null;
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  return hour < 12 ? "premarket" : "afterhours";
}

/** Precise ET clock for timeline rows — HH:mm from Benzinga time field. */
export function earningsReportTimeEt(time: string | null): string | null {
  if (!time) return null;
  const parts = time.split(":");
  if (parts.length < 2) return null;
  return `${parts[0]!.padStart(2, "0")}:${parts[1]!.padStart(2, "0")}`;
}

export function impactFromEarningsImportance(importance: number | null | undefined): MeridianImpact {
  if (importance == null || !Number.isFinite(importance)) return "high";
  if (importance >= 4) return "high";
  if (importance >= 2) return "medium";
  return "low";
}

export function benzingaToCalendarRow(row: BenzingaStructuredEarnings): MeridianEarningsCalendarRow {
  return {
    benzinga_id: row.benzinga_id,
    date: row.date,
    time: row.time,
    report_time_et: earningsReportTimeEt(row.time),
    date_status: row.date_status,
    fiscal_period: row.fiscal_period,
    fiscal_year: row.fiscal_year,
    importance: row.importance,
    currency: row.currency,
    estimated_eps: row.estimated_eps,
    actual_eps: row.actual_eps,
    eps_surprise: row.eps_surprise,
    eps_surprise_pct: benzingaSurpriseToDisplayPct(row.eps_surprise_pct),
    estimated_revenue: row.estimated_revenue,
    actual_revenue: row.actual_revenue,
    revenue_surprise: row.revenue_surprise,
    revenue_surprise_pct: benzingaSurpriseToDisplayPct(row.revenue_surprise_pct),
    previous_eps: row.previous_eps,
    previous_revenue: row.previous_revenue,
    eps_method: row.eps_method,
    revenue_method: row.revenue_method,
    notes: row.notes,
    last_updated: row.last_updated,
    is_printed: row.actual_eps != null || row.actual_revenue != null,
  };
}

export function benzingaToStreetEstimate(row: BenzingaStructuredEarnings): MeridianStreetEstimate {
  const period =
    row.fiscal_period && row.fiscal_year != null
      ? `${row.fiscal_period} FY${String(row.fiscal_year).slice(-2)}`
      : row.fiscal_period ?? row.date;
  return {
    period,
    eps_estimate: row.estimated_eps,
    revenue_estimate: row.estimated_revenue,
    source: "earnings_calendar",
  };
}

export function computeEarningsYoY(row: BenzingaStructuredEarnings | MeridianEarningsCalendarRow): MeridianEarningsYoY | null {
  const est = row.estimated_eps;
  const prev = row.previous_eps;
  const rev = row.estimated_revenue;
  const prevRev = row.previous_revenue;
  const eps_yoy_pct =
    est != null && prev != null && prev !== 0 ? Number((((est - prev) / Math.abs(prev)) * 100).toFixed(1)) : null;
  const revenue_yoy_pct =
    rev != null && prevRev != null && prevRev !== 0
      ? Number((((rev - prevRev) / Math.abs(prevRev)) * 100).toFixed(1))
      : null;
  if (eps_yoy_pct == null && revenue_yoy_pct == null) return null;
  return { eps_yoy_pct, revenue_yoy_pct };
}

export function benzingaRowToTimelineInput(row: BenzingaStructuredEarnings): EarningsTimelineInput {
  const when = earningsWhenFromTime(row.time);
  return {
    ticker: row.ticker,
    name: row.company_name?.trim() || row.ticker,
    report_date: row.date,
    when: when ?? "afterhours",
    report_time: earningsReportTimeEt(row.time),
    date_status: row.date_status,
    importance: row.importance,
    expected_move_pct: null,
    is_printed: row.actual_eps != null || row.actual_revenue != null,
    eps_method: row.eps_method,
    revenue_method: row.revenue_method,
    estimated_eps: row.estimated_eps,
    source: "earnings_calendar",
  };
}

function earningsTimelineKey(ticker: string, date: string): string {
  return `${ticker.toUpperCase()}:${date.slice(0, 10)}`;
}

/**
 * Benzinga calendar rows → timeline inputs (sorted by report date).
 */
export function benzingaRowsToTimelineInputs(
  benzingaRows: BenzingaStructuredEarnings[]
): EarningsTimelineInput[] {
  return benzingaRows
    .map(benzingaRowToTimelineInput)
    .sort((a, b) => (a.report_date ?? "").localeCompare(b.report_date ?? ""));
}

/** Overlay Polygon chain-IV expected move onto timeline rows (keyed by ticker). */
export function overlayTimelineExpectedMoves(
  rows: EarningsTimelineInput[],
  emByTicker: Map<string, number | null>
): EarningsTimelineInput[] {
  return rows.map((row) => {
    const em = emByTicker.get(row.ticker.trim().toUpperCase());
    if (em == null) return row;
    return { ...row, expected_move_pct: em, source: row.source ?? "earnings_calendar" };
  });
}

/** Next upcoming print from Benzinga structured earnings (Meridian/Largo — no UW REST). */
export function parseNextEarningsFromBenzinga(
  ticker: string,
  rows: BenzingaStructuredEarnings[],
  todayYmd: string
): NextEarnings | null {
  const sym = ticker.trim().toUpperCase();
  const upcoming = rows
    .filter((r) => r.date >= todayYmd)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  const row = upcoming[0];
  if (!row) return null;
  const days = daysBetweenYmd(todayYmd, row.date);
  if (days == null || days < 0) return null;
  const when = earningsWhenFromTime(row.time);
  return {
    ticker: sym,
    earnings_date: row.date,
    days_until: days,
    report_time: when ?? null,
    is_confirmed:
      row.date_status === "confirmed" ? true : row.date_status === "projected" ? false : null,
  };
}

/**
 * @deprecated UW grid removed — use benzingaRowsToTimelineInputs + overlayTimelineExpectedMoves.
 * Kept for tests migrating off the old merge shape.
 */
export function mergeEarningsTimelineSources(
  benzingaRows: BenzingaStructuredEarnings[],
  gridRows: EarningsTimelineInput[]
): EarningsTimelineInput[] {
  const byKey = new Map<string, EarningsTimelineInput>();
  const benzingaByTicker = new Map<string, BenzingaStructuredEarnings>();

  for (const row of benzingaRows) {
    byKey.set(earningsTimelineKey(row.ticker, row.date), benzingaRowToTimelineInput(row));
    const prev = benzingaByTicker.get(row.ticker);
    if (!prev || row.date < prev.date) benzingaByTicker.set(row.ticker, row);
  }

  for (const grid of gridRows) {
    const ticker = grid.ticker.trim().toUpperCase();
    const date = grid.report_date?.slice(0, 10);
    if (!ticker || !date) continue;
    const key = earningsTimelineKey(ticker, date);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        expected_move_pct: grid.expected_move_pct ?? existing.expected_move_pct,
        when: existing.when ?? grid.when,
        source: existing.source ?? "earnings_calendar",
      });
      continue;
    }

    const bz = benzingaByTicker.get(ticker);
    if (bz && bz.date !== date && bz.date_status === "confirmed") {
      continue;
    }
    byKey.set(key, {
      ...grid,
      ticker,
      report_date: date,
      source: "chain_iv",
    });
  }

  return [...byKey.values()].sort((a, b) => (a.report_date ?? "").localeCompare(b.report_date ?? ""));
}

/** @deprecated Use mergeEarningsTimelineSources */
export function mergeBenzingaTimelineRows(
  existing: Map<string, EarningsTimelineInput>,
  benzingaRows: BenzingaStructuredEarnings[]
): Map<string, EarningsTimelineInput> {
  const grid = [...existing.values()];
  const merged = mergeEarningsTimelineSources(benzingaRows, grid);
  const out = new Map<string, EarningsTimelineInput>();
  for (const row of merged) out.set(row.ticker.toUpperCase(), row);
  return out;
}

export function mergeStreetEstimates(
  benzingaRows: BenzingaStructuredEarnings[],
  uwRows: MeridianStreetEstimate[]
): MeridianStreetEstimate[] {
  const upcoming = benzingaRows
    .filter((r) => r.actual_eps == null && (r.estimated_eps != null || r.estimated_revenue != null))
    .sort((a, b) => a.date.localeCompare(b.date));
  const fromBenzinga = upcoming.slice(0, 4).map(benzingaToStreetEstimate);
  if (!fromBenzinga.length) return uwRows.slice(0, 4);
  const periods = new Set(fromBenzinga.map((r) => r.period));
  const tail = uwRows.filter((r) => r.period && !periods.has(r.period)).slice(0, 2);
  return [...fromBenzinga, ...tail].slice(0, 6);
}

export function pickEarningsCalendarRow(
  rows: BenzingaStructuredEarnings[],
  eventDate: string | null | undefined
): MeridianEarningsCalendarRow | null {
  if (!eventDate) return null;
  const match = rows.find((r) => r.date === eventDate) ?? rows[0] ?? null;
  return match ? benzingaToCalendarRow(match) : null;
}

export function benzingaRowsToPrintHistory(
  rows: BenzingaStructuredEarnings[],
  limit = 8
): MeridianEarningsPrint[] {
  return rows
    .filter((r) => r.actual_eps != null || r.actual_revenue != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((r) => {
      const surprise_pct = benzingaSurpriseToDisplayPct(r.eps_surprise_pct);
      let beat: boolean | null = null;
      if (r.eps_surprise != null) beat = r.eps_surprise >= 0;
      else if (surprise_pct != null) beat = surprise_pct >= 0;
      return {
        report_date: r.date,
        eps_estimate: r.estimated_eps,
        eps_actual: r.actual_eps,
        revenue_estimate: r.estimated_revenue,
        revenue_actual: r.actual_revenue,
        revenue_surprise_pct: benzingaSurpriseToDisplayPct(r.revenue_surprise_pct),
        surprise_pct,
        beat,
        eps_method: r.eps_method,
        revenue_method: r.revenue_method,
        expected_move_pct: null,
        session_change_pct: null,
        next_day_change_pct: null,
        source: "earnings_calendar" as const,
      };
    });
}

export function dualBeatRateFromPrints(prints: MeridianEarningsPrint[]): {
  eps_beat_rate: number | null;
  revenue_beat_rate: number | null;
  combined_beat_rate: number | null;
} {
  const epsGraded = prints.filter((p) => p.beat != null);
  const revGraded = prints.filter((p) => p.revenue_surprise_pct != null);
  const eps_beat_rate =
    epsGraded.length > 0 ? epsGraded.filter((p) => p.beat).length / epsGraded.length : null;
  const revenue_beat_rate =
    revGraded.length > 0
      ? revGraded.filter((p) => (p.revenue_surprise_pct ?? 0) >= 0).length / revGraded.length
      : null;
  const combined =
    eps_beat_rate != null && revenue_beat_rate != null
      ? (eps_beat_rate + revenue_beat_rate) / 2
      : eps_beat_rate ?? revenue_beat_rate;
  return { eps_beat_rate, revenue_beat_rate, combined_beat_rate: combined };
}

export function buildEarningsWeekRows(
  rows: BenzingaStructuredEarnings[],
  todayYmd: string,
  daysAhead: number
): MeridianEarningsWeekRow[] {
  const end = addDaysYmd(todayYmd, daysAhead);
  return rows
    .filter((r) => r.date >= todayYmd && r.date <= end && (r.importance ?? 0) >= 4)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 24)
    .map((r) => ({
      ticker: r.ticker,
      company_name: r.company_name,
      date: r.date,
      time_et: earningsReportTimeEt(r.time),
      importance: r.importance,
      date_status: r.date_status,
      estimated_eps: r.estimated_eps,
      is_printed: r.actual_eps != null,
    }));
}

export function buildRecentEarningsRevisions(
  rows: BenzingaStructuredEarnings[],
  sinceIso: string
): MeridianEarningsRevision[] {
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return [];
  return rows
    .filter((r) => r.last_updated && Date.parse(r.last_updated) >= sinceMs)
    .sort((a, b) => (b.last_updated ?? "").localeCompare(a.last_updated ?? ""))
    .slice(0, 12)
    .map((r) => ({
      ticker: r.ticker,
      date: r.date,
      company_name: r.company_name,
      last_updated: r.last_updated,
      date_status: r.date_status,
      importance: r.importance,
      headline: revisionHeadline(r),
    }));
}

function revisionHeadline(row: BenzingaStructuredEarnings): string {
  if (row.actual_eps != null) {
    const surp = benzingaSurpriseToDisplayPct(row.eps_surprise_pct);
    return surp != null
      ? `${row.ticker} printed EPS ${row.actual_eps} (${surp >= 0 ? "+" : ""}${surp}% vs est)`
      : `${row.ticker} printed EPS ${row.actual_eps}`;
  }
  if (row.date_status === "confirmed") return `${row.ticker} date confirmed · ${row.date}`;
  if (row.estimated_eps != null) return `${row.ticker} estimate updated · EPS ${row.estimated_eps}`;
  return `${row.ticker} calendar updated · ${row.date}`;
}

export function guidanceToMeridianRow(row: BenzingaCorporateGuidance): MeridianEarningsGuidanceRow {
  return {
    date: row.date,
    fiscal_period: row.fiscal_period,
    fiscal_year: row.fiscal_year,
    release_type: row.release_type,
    min_eps: row.min_eps_guidance,
    max_eps: row.max_eps_guidance,
    min_revenue: row.min_revenue_guidance,
    max_revenue: row.max_revenue_guidance,
    street_eps: row.estimated_eps_guidance,
    street_revenue: row.estimated_revenue_guidance,
    eps_method: row.eps_method,
    revenue_method: row.revenue_method,
    notes: row.notes,
    last_updated: row.last_updated,
  };
}

export function postPrintSurpriseLean(
  cal: MeridianEarningsCalendarRow | null
): { lean: "beat" | "miss" | "inline" | "unknown"; headline: string | null; score: number } {
  if (!cal?.is_printed) return { lean: "unknown", headline: null, score: 0 };
  const eps = cal.eps_surprise_pct;
  const rev = cal.revenue_surprise_pct;
  if (eps == null && rev == null) return { lean: "unknown", headline: "Print landed — surprise pending", score: 0 };
  const epsBeat = eps != null ? eps >= 0 : null;
  const revBeat = rev != null ? rev >= 0 : null;
  if (epsBeat === true && (revBeat === true || revBeat === null)) {
    return {
      lean: "beat",
      headline: `Beat · EPS ${eps != null ? `${eps >= 0 ? "+" : ""}${eps}%` : "—"}${rev != null ? ` · Rev ${rev >= 0 ? "+" : ""}${rev}%` : ""}`,
      score: 2,
    };
  }
  if (epsBeat === false && (revBeat === false || revBeat === null)) {
    return {
      lean: "miss",
      headline: `Miss · EPS ${eps != null ? `${eps}%` : "—"}${rev != null ? ` · Rev ${rev}%` : ""}`,
      score: -2,
    };
  }
  return { lean: "inline", headline: "Mixed print vs street", score: 0 };
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
