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
import {
  buildOptionableIndex,
  partitionOptionable,
} from "@/lib/meridian/meridian-optionable-core";
import { classifyTickerSectors } from "@/lib/meridian/meridian-sector-classify";
import { orderTickersForClassification } from "@/lib/meridian/meridian-sector-core";
import { fetchUwOptionableTickers } from "@/lib/providers/unusual-whales";
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
  earnings_analytics_rows: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["earnings_analytics_rows"];
  earnings_week_analytics: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["earnings_week_analytics"];
  recent_revisions: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["recent_revisions"];
  estimate_revision_timeline: Awaited<
    ReturnType<typeof loadBenzingaEarningsBundle>
  >["estimate_revision_timeline"];
  after_hours_movers: Awaited<ReturnType<typeof loadBenzingaEarningsBundle>>["after_hours_movers"];
  calendar_entitled: boolean;
  /** How many prints were hidden because the name has no listed options. */
  non_optionable_hidden: number;
  /** False when the optionable universe was unavailable, so NOTHING was filtered. */
  optionable_filter_applied: boolean;
  /** How many lane rows carry a sector cohort key, and how many do not. Coverage, stated. */
  sectors_classified: number;
  sectors_unclassified: number;
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

  // Drop prints on names with no listed options. Everything this platform serves is an options
  // product, so a print with no chain is a row a member cannot act on — and the calendar is
  // dominated by them. Filtering HERE, before the expected-move batch, also stops us fetching
  // Polygon chains for names that have none.
  //
  // Fails OPEN: if the universe is unavailable, nothing is filtered and the flag says so. An
  // empty earnings lane would tell the reader "there are no earnings this week", which is a lie
  // an infrastructure error must never be allowed to tell.
  const optionableList = await fetchUwOptionableTickers();
  const split = partitionOptionable(rows, buildOptionableIndex(optionableList), (r) => r.ticker);
  rows = split.kept;

  const emByTicker = await batchLoadEarningsExpectedMovePct(
    rows.map((r) => ({ ticker: r.ticker, report_date: r.report_date }))
  );
  rows = overlayTimelineExpectedMoves(rows, emByTicker);

  // Sector cohort key, so the lane can group and the detail panel can rank a name against the
  // peers reporting alongside it. Attached AFTER the optionable filter on purpose — classifying
  // names we are about to hide would spend a Polygon call per row for nothing.
  //
  // Never fatal: `classifyTickerSectors` returns unclassified names rather than throwing, and a
  // row with no sector simply joins no cohort. A sector lookup outage must not empty the lane.
  //
  // ORDER MATTERS, and the lane is bigger than the lookup budget. Measured live 2026-08-18:
  // 199 earnings rows against a 120-lookup cap, so 79 names were skipped in arbitrary calendar
  // order. Worse, only 22 rows carried a NUMERIC implied move — and a cohort needs at least
  // MIN_COHORT_PEERS peers WITH VALUES before it can rank anything. Spending the budget in
  // calendar order therefore classified many rows that could never contribute to a distribution
  // while skipping ones that could.
  //
  // So: names that carry an implied move go first. Same cost, far more usable cohorts.
  const classifyOrder = orderTickersForClassification(
    rows,
    (r) => r.expected_move_pct != null,
    (r) => r.ticker
  );
  const sectors = await classifyTickerSectors(classifyOrder).catch(() => null);
  if (sectors) {
    rows = rows.map((r) => {
      const cls = sectors.byTicker[r.ticker.toUpperCase()];
      return cls?.majorGroup
        ? { ...r, sic_major_group: cls.majorGroup, sector_label: cls.label }
        : r;
    });
  }

  return {
    rows,
    sectors_classified: rows.filter((r) => r.sic_major_group).length,
    sectors_unclassified: rows.filter((r) => !r.sic_major_group).length,
    earnings_week: bundle.earnings_week,
    earnings_analytics_rows: bundle.earnings_analytics_rows,
    earnings_week_analytics: bundle.earnings_week_analytics,
    recent_revisions: bundle.recent_revisions,
    estimate_revision_timeline: bundle.estimate_revision_timeline,
    after_hours_movers: bundle.after_hours_movers,
    calendar_entitled: bundle.entitled && boardRes.entitled,
    non_optionable_hidden: split.hidden.length,
    optionable_filter_applied: split.applied,
  };
}
