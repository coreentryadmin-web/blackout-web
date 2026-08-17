import "server-only";

import { serverCache } from "@/lib/server-cache";
import type { EarningsTimelineInput, FdaTimelineInput } from "@/features/meridian/lib/meridian-timeline";
import { readGridEarnings, type ZeroDteEarningsItem } from "@/lib/zerodte/earnings";
import { daysUntilEt } from "@/features/meridian/lib/meridian-timeline";

const AV_KEY = process.env.ALPHAVANTAGE_API_KEY?.trim() || "";
const TTL_12H = 12 * 60 * 60 * 1000;
const FDA_CACHE_TTL = 30 * 60 * 1000;

async function loadAvEarningsMap(): Promise<Record<string, string>> {
  if (!AV_KEY || AV_KEY === "demo") return {};
  return serverCache("meridian:earnings-calendar:av:3m", TTL_12H, async () => {
    const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${AV_KEY}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return {};
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return {};
    const out: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(",");
      const symbol = cols[0]?.trim().toUpperCase();
      const date = cols[2]?.trim();
      if (symbol && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        if (!out[symbol] || date < out[symbol]!) out[symbol] = date;
      }
    }
    return out;
  }).catch(() => ({}));
}

function gridToInput(row: ZeroDteEarningsItem): EarningsTimelineInput {
  return {
    ticker: row.ticker,
    name: row.name,
    report_date: row.report_date,
    when: row.when,
    expected_move_pct: row.expected_move_pct,
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

/** Earnings rows for the Meridian timeline — grid snapshot + optional AV 3-month calendar. */
export async function loadMeridianEarningsTimeline(
  todayYmd: string,
  daysAhead: number
): Promise<EarningsTimelineInput[]> {
  const [grid, avMap] = await Promise.all([
    readGridEarnings().catch(() => null),
    loadAvEarningsMap(),
  ]);

  const byTicker = new Map<string, EarningsTimelineInput>();

  for (const row of grid?.items ?? []) {
    if (!row.ticker || !row.report_date) continue;
    if (daysUntilEt(row.report_date, todayYmd) > daysAhead) continue;
    byTicker.set(row.ticker.toUpperCase(), gridToInput(row));
  }

  for (const [ticker, date] of Object.entries(avMap)) {
    if (date < todayYmd || daysUntilEt(date, todayYmd) > daysAhead) continue;
    if (byTicker.has(ticker)) continue;
    byTicker.set(ticker, {
      ticker,
      name: ticker,
      report_date: date,
      when: "afterhours",
      expected_move_pct: null,
    });
  }

  return [...byTicker.values()].sort((a, b) =>
    (a.report_date ?? "").localeCompare(b.report_date ?? "")
  );
}
