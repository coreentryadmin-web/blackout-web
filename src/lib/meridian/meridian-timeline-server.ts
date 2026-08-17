import "server-only";

import { serverCache } from "@/lib/server-cache";
import type { EarningsTimelineInput, FdaTimelineInput } from "@/features/meridian/lib/meridian-timeline";
import { readGridEarnings, type ZeroDteEarningsItem } from "@/lib/zerodte/earnings";
import { daysUntilEt } from "@/features/meridian/lib/meridian-timeline";
import { mergeEarningsTimelineSources } from "@/lib/meridian/meridian-benzinga-earnings-core";
import {
  loadBenzingaBoardEarnings,
  loadBenzingaEarningsBundle,
} from "@/lib/meridian/meridian-benzinga-earnings";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

const FDA_CACHE_TTL = 30 * 60 * 1000;

function gridToInput(row: ZeroDteEarningsItem & { report_date: string }): EarningsTimelineInput {
  return {
    ticker: row.ticker,
    name: row.name,
    report_date: row.report_date,
    when: row.when,
    expected_move_pct: row.expected_move_pct,
    source: "uw_grid",
  };
}

function firstYmd(row: Record<string, unknown>): string {
  for (const key of ["date", "decision_date", "pdufa_date", "event_date", "target_date", "due_date"]) {
    const v = String(row[key] ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return "";
}

function shapeFdaRow(row: Record<string, unknown>): FdaTimelineInput | null {
  const ticker = String(row.ticker ?? row.symbol ?? "").trim().toUpperCase();
  const date = firstYmd(row);
  if (!ticker || !date) return null;
  const drug = String(row.drug ?? row.drug_name ?? row.product ?? row.name ?? "").trim() || null;
  const indication = String(row.indication ?? row.description ?? "").trim() || null;
  const event_label = String(row.event ?? row.event_type ?? row.title ?? "").trim() || null;
  return { ticker, date, drug, indication, event_label };
}

function dedupeBenzingaRows(rows: BenzingaStructuredEarnings[]): BenzingaStructuredEarnings[] {
  const seen = new Set<string>();
  const out: BenzingaStructuredEarnings[] = [];
  for (const row of rows) {
    const key = row.benzinga_id ?? `${row.ticker}:${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Market-wide FDA calendar rows for the Meridian timeline (cluster-cached). */
export async function loadMeridianFdaTimeline(
  todayYmd: string,
  daysAhead: number
): Promise<FdaTimelineInput[]> {
  const rows = await serverCache("meridian:fda-calendar:all:v1", FDA_CACHE_TTL, async () => {
    const { uwConfigured } = await import("@/lib/providers/config");
    if (!uwConfigured()) return [] as Record<string, unknown>[];
    const { fetchUwFdaCalendarAll } = await import("@/lib/providers/unusual-whales");
    return fetchUwFdaCalendarAll(50);
  }).catch(() => [] as Record<string, unknown>[]);

  const seen = new Set<string>();
  const out: FdaTimelineInput[] = [];
  for (const row of rows) {
    const shaped = shapeFdaRow(row);
    if (!shaped) continue;
    if (shaped.date < todayYmd || daysUntilEt(shaped.date, todayYmd) > daysAhead) continue;
    const key = `${shaped.ticker}:${shaped.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(shaped);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type MeridianEarningsTimelineResult = {
  rows: EarningsTimelineInput[];
  earnings_week: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["earnings_week"];
  recent_revisions: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["recent_revisions"];
  calendar_entitled: boolean;
};

/** Earnings rows for the Meridian timeline — Benzinga calendar primary, UW grid overlay for implied move. */
export async function loadMeridianEarningsTimeline(
  todayYmd: string,
  daysAhead: number,
  boardTickers: string[] = []
): Promise<MeridianEarningsTimelineResult> {
  const [grid, bundle, boardRes] = await Promise.all([
    readGridEarnings().catch(() => null),
    loadBenzingaEarningsBundle(todayYmd, daysAhead),
    loadBenzingaBoardEarnings(boardTickers, todayYmd, daysAhead),
  ]);

  const gridRows: EarningsTimelineInput[] = [];
  for (const row of grid?.items ?? []) {
    const reportDate = row.report_date?.slice(0, 10);
    if (!row.ticker || !reportDate) continue;
    if (daysUntilEt(reportDate, todayYmd) > daysAhead) continue;
    gridRows.push(gridToInput({ ...row, report_date: reportDate }));
  }

  const benzingaRows = dedupeBenzingaRows([
    ...bundle.window_rows,
    ...boardRes.rows,
  ]).filter((r) => r.date >= todayYmd && daysUntilEt(r.date, todayYmd) <= daysAhead);

  const rows = mergeEarningsTimelineSources(benzingaRows, gridRows);

  return {
    rows,
    earnings_week: bundle.earnings_week,
    recent_revisions: bundle.recent_revisions,
    calendar_entitled: bundle.entitled && boardRes.entitled,
  };
}
