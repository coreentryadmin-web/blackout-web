import "server-only";

import { daysUntilEt } from "@/features/meridian/lib/meridian-timeline";
import type { EarningsTimelineInput, FdaTimelineInput } from "@/features/meridian/lib/meridian-timeline";
import { serverCache } from "@/lib/server-cache";
import {
  benzingaRowsToTimelineInputs,
  overlayTimelineExpectedMoves,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import {
  loadBenzingaBoardEarnings,
  loadBenzingaEarningsBundle,
} from "@/lib/meridian/meridian-benzinga-earnings";
import { batchLoadEarningsExpectedMovePct } from "@/lib/meridian/meridian-earnings-expected-move";
import type { BenzingaStructuredEarnings } from "@/lib/providers/polygon";

const FDA_CACHE_TTL = 30 * 60 * 1000;

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
  earnings_week_analytics: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["earnings_week_analytics"];
  recent_revisions: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["recent_revisions"];
  estimate_revision_timeline: Awaited<
    ReturnType<typeof loadBenzingaEarningsBundle>
  >["estimate_revision_timeline"];
  after_hours_movers: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["after_hours_movers"];
  calendar_entitled: boolean;
};

/** Earnings rows — Benzinga calendar + Polygon chain-IV expected move (no UW earnings REST). */
export async function loadMeridianEarningsTimeline(
  todayYmd: string,
  daysAhead: number,
  boardTickers: string[] = []
): Promise<MeridianEarningsTimelineResult> {
  const [bundle, boardRes] = await Promise.all([
    loadBenzingaEarningsBundle(todayYmd, daysAhead),
    loadBenzingaBoardEarnings(boardTickers, todayYmd, daysAhead),
  ]);

  const benzingaRows = dedupeBenzingaRows([
    ...bundle.window_rows,
    ...boardRes.rows,
  ]).filter((r) => r.date >= todayYmd && daysUntilEt(r.date, todayYmd) <= daysAhead);

  let rows = benzingaRowsToTimelineInputs(benzingaRows);
  const emByTicker = await batchLoadEarningsExpectedMovePct(
    rows.map((r) => ({ ticker: r.ticker, report_date: r.report_date }))
  );
  rows = overlayTimelineExpectedMoves(rows, emByTicker);

  return {
    rows,
    earnings_week: bundle.earnings_week,
    earnings_week_analytics: bundle.earnings_week_analytics,
    recent_revisions: bundle.recent_revisions,
    estimate_revision_timeline: bundle.estimate_revision_timeline,
    after_hours_movers: bundle.after_hours_movers,
    calendar_entitled: bundle.entitled && boardRes.entitled,
  };
}
