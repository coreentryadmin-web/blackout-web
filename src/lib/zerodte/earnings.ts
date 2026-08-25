// 0DTE Command — market-wide earnings-match cache (cache-reader rule).
//
// Relocated from the deleted classic-Grid "Earnings Radar" panel (src/lib/providers/grid.ts,
// removed 2026-07-07 when classic Grid was deleted entirely). The panel/UI is gone, but this
// snapshot is a REAL, active dependency: zerodte-service.ts's buildZeroDteBoardPayload() calls
// readGridEarnings() to flag setups on tickers reporting today/tomorrow (via board.ts's
// matchEarnings()). So the fetch+cache pair moves here instead of dying with the rest of Grid.
//
// Cache-reader rule preserved as-is: one cluster-wide writer (now the `zerodte-warm` cron, see
// src/app/api/cron/zerodte-warm/route.ts) pulls UW's premarket/afterhours earnings feeds ONCE
// per warm window and writes this snapshot to Redis; readGridEarnings() below only ever reads
// that snapshot (falling back to a direct fetch on a cold cache, same as before the move).
//
// FALLBACK (2026-07-31): when the UW earnings read fails or times out, shape the Alpha Vantage
// earnings calendar (same source as `/api/market/earnings-calendar`) into this snapshot so G-11
// fail-closed does not blanket-block every fresh 0DTE commit on a blind feed.

import {
  getUwCacheRedis,
  uwCacheGet,
  uwCacheRead,
  uwCacheSet,
} from "@/lib/providers/uw-shared-cache";
import {
  fetchUwEarningsPremarket,
  fetchUwEarningsAfterhours,
} from "@/lib/providers/unusual-whales";
import { serverCache } from "@/lib/server-cache";
import { todayEt, nextTradingDayEt } from "@/features/nighthawk/lib/session";

/** Exported so cron-writer-target-fresh.ts can freshness-probe the raw Redis key without
 *  triggering a live upstream fetch (readGridEarnings() falls back to fetching on a cache miss). */
export const ZERODTE_EARNINGS_KEY = "grid:earnings";
const ZERODTE_EARNINGS_TTL = 300; // 5 min — earnings reporters update a few times per day
const UW_READ_RACE_MS = 2_000;
const AV_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type ZeroDteEarningsItem = {
  ticker: string;
  name: string;
  eps_estimate: number | null;
  eps_actual: number | null;
  surprise_pct: number | null;
  /** Report (earnings) date, ISO yyyy-mm-dd. */
  report_date: string | null;
  /** Options-implied expected move around the print, as a percent (e.g. 11.5). */
  expected_move_pct: number | null;
  when: "premarket" | "afterhours";
};

export type ZeroDteEarningsSnapshot = {
  as_of: string;
  items: ZeroDteEarningsItem[];
};

function shapeEarningsRows(
  rows: Record<string, unknown>[],
  when: "premarket" | "afterhours"
): ZeroDteEarningsItem[] {
  return rows.map((r) => {
    const epsEst = r.street_mean_est ?? r.eps_estimate ?? r.estimate ?? r.estimated_eps ?? null;
    const epsAct = r.actual_eps ?? r.eps_actual ?? r.actual ?? r.reported_eps ?? null;
    const est = epsEst != null ? Number(epsEst) : null;
    const act = epsAct != null ? Number(epsAct) : null;
    const surprise =
      est != null && act != null && Number.isFinite(est) && Number.isFinite(act) && est !== 0
        ? Number((((act - est) / Math.abs(est)) * 100).toFixed(1))
        : null;
    const emRaw = r.expected_move_perc ?? r.expected_move_pct ?? null;
    const emPct = emRaw != null && Number.isFinite(Number(emRaw)) ? Number(emRaw) * 100 : null;
    return {
      ticker: String(r.ticker ?? r.symbol ?? "").toUpperCase(),
      name: String(r.full_name ?? r.name ?? r.company ?? ""),
      eps_estimate: est != null && Number.isFinite(est) ? est : null,
      eps_actual: act != null && Number.isFinite(act) ? act : null,
      surprise_pct: surprise != null && Number.isFinite(surprise) ? surprise : null,
      report_date: String(r.report_date ?? r.earnings_date ?? r.date ?? "").slice(0, 10) || null,
      expected_move_pct: emPct != null ? Number(emPct.toFixed(1)) : null,
      when,
    };
  }).filter((x) => x.ticker);
}

async function fetchUwEarnings(): Promise<ZeroDteEarningsSnapshot> {
  const [pm, ah] = await Promise.all([
    fetchUwEarningsPremarket(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "premarket")
    ).catch(() => [] as ZeroDteEarningsItem[]),
    fetchUwEarningsAfterhours(20).then((r) =>
      shapeEarningsRows(r as Record<string, unknown>[], "afterhours")
    ).catch(() => [] as ZeroDteEarningsItem[]),
  ]);
  return { as_of: new Date().toISOString(), items: [...pm, ...ah] };
}

async function loadAvEarningsCalendar(): Promise<Record<string, string>> {
  const apiKey =
    process.env.ALPHAVANTAGE_API_KEY?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "demo");
  if (!apiKey) return {};
  const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const symbol = cols[0]?.trim().toUpperCase();
    const date = cols[2]?.trim();
    if (symbol && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (!out[symbol] || date < out[symbol]) out[symbol] = date;
    }
  }
  return out;
}

export function inferWhenForDate(
  reportDate: string,
  today: string,
  nextDay: string,
  nowMs = Date.now()
): "premarket" | "afterhours" {
  if (reportDate === today) {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(new Date(nowMs))
    ) % 24;
    return hour < 12 ? "premarket" : "afterhours";
  }
  if (reportDate === nextDay) return "afterhours";
  return "afterhours";
}

/** Alpha Vantage calendar fallback — same 3-month feed as `/api/market/earnings-calendar`. */
export async function readAvEarningsSnapshot(): Promise<ZeroDteEarningsSnapshot | null> {
  try {
    const calendar = await serverCache("earnings-calendar:av:3m", AV_CACHE_TTL_MS, loadAvEarningsCalendar);
    const today = todayEt();
    const nextDay = nextTradingDayEt(today);
    const items: ZeroDteEarningsItem[] = [];
    for (const [ticker, report_date] of Object.entries(calendar)) {
      if (report_date !== today && report_date !== nextDay) continue;
      items.push({
        ticker,
        name: "",
        eps_estimate: null,
        eps_actual: null,
        surprise_pct: null,
        report_date,
        expected_move_pct: null,
        when: inferWhenForDate(report_date, today, nextDay),
      });
    }
    if (!items.length) return null;
    return { as_of: new Date().toISOString(), items };
  } catch {
    return null;
  }
}

export async function warmGridEarnings(): Promise<ZeroDteEarningsSnapshot | null> {
  // Mirror readGridEarnings()'s UW race — an unbounded UW pull blocked zerodte-warm's handshake
  // past Cloudflare's ~100s origin timeout during RTH (grid-rth-2026-08-04: HTTP 504).
  const uw = await Promise.race([
    fetchUwEarnings(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), UW_READ_RACE_MS)),
  ]);
  const snapshot = uw?.items?.length ? uw : await readAvEarningsSnapshot();
  if (!snapshot?.items?.length) return null;
  const redis = await getUwCacheRedis();
  await uwCacheSet(redis, ZERODTE_EARNINGS_KEY, ZERODTE_EARNINGS_TTL, snapshot);
  return snapshot;
}

export async function readGridEarnings(): Promise<ZeroDteEarningsSnapshot | null> {
  const redis = await getUwCacheRedis();

  if (redis) {
    try {
      const cached = await uwCacheRead<ZeroDteEarningsSnapshot>(ZERODTE_EARNINGS_KEY);
      if (cached?.items?.length) return cached;
    } catch {
      /* fall through */
    }
  }

  try {
    const uw = await Promise.race([
      fetchUwEarnings(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), UW_READ_RACE_MS)),
    ]);
    if (uw?.items?.length) {
      void uwCacheSet(redis, ZERODTE_EARNINGS_KEY, ZERODTE_EARNINGS_TTL, uw).catch(() => undefined);
      return uw;
    }
  } catch {
    /* fall through to AV */
  }

  return readAvEarningsSnapshot();
}
