/**
 * Pre-earnings desk pack — one intent bundles positioning, flow, history, board exposure.
 */

import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { fetchNextEarningsDate } from "@/lib/providers/uw-earnings";
import { fetchUwTickerEarningsHistory } from "@/lib/providers/unusual-whales";
import { readGridEarnings } from "@/lib/zerodte/earnings";
import { matchEarnings } from "@/lib/zerodte/board";
import { nextTradingDayEt } from "@/features/nighthawk/lib/session";

export type PreEarningsHistoryRow = {
  report_date: string | null;
  surprise_pct: number | null;
  beat: boolean | null;
  expected_move_pct: number | null;
};

export type PreEarningsExposure = {
  on_board: boolean;
  status: string | null;
  direction: string | null;
  pnl_pct: number | null;
  headline: string | null;
};

export type PreEarningsPackCard = {
  kind: "pre_earnings";
  ticker: string;
  earnings_date: string | null;
  days_until: number | null;
  report_time: "premarket" | "afterhours" | "unknown" | null;
  is_confirmed: boolean | null;
  expected_move_pct: number | null;
  positioning: {
    available: boolean;
    flip: number | null;
    call_wall: number | null;
    put_wall: number | null;
    spot: number | null;
    gamma_regime: string | null;
  };
  flow: {
    available: boolean;
    bias: string;
    summary: string;
    net_premium: number | null;
  };
  history: PreEarningsHistoryRow[];
  history_summary: string | null;
  zerodte: PreEarningsExposure | null;
  nighthawk: PreEarningsExposure | null;
  as_of: string;
};

function parseSurprise(row: Record<string, unknown>): PreEarningsHistoryRow {
  const est = row.street_mean_est ?? row.eps_estimate ?? row.estimate ?? null;
  const act = row.actual_eps ?? row.eps_actual ?? row.actual ?? null;
  const estN = est != null ? Number(est) : null;
  const actN = act != null ? Number(act) : null;
  let surprise: number | null = null;
  let beat: boolean | null = null;
  if (estN != null && actN != null && estN !== 0) {
    surprise = Number((((actN - estN) / Math.abs(estN)) * 100).toFixed(1));
    beat = actN >= estN;
  } else if (row.surprise_pct != null && Number.isFinite(Number(row.surprise_pct))) {
    surprise = Number(row.surprise_pct);
    beat = surprise >= 0;
  }
  const emRaw = row.expected_move_perc ?? row.expected_move_pct ?? null;
  const emPct =
    emRaw != null && Number.isFinite(Number(emRaw))
      ? Number((Number(emRaw) * (Number(emRaw) <= 1 ? 100 : 1)).toFixed(1))
      : null;
  const reportDate = String(row.report_date ?? row.earnings_date ?? row.date ?? "").slice(0, 10) || null;
  return {
    report_date: reportDate,
    surprise_pct: surprise,
    beat,
    expected_move_pct: emPct,
  };
}

function historySummary(rows: PreEarningsHistoryRow[]): string | null {
  const graded = rows.filter((r) => r.beat != null);
  if (!graded.length) return null;
  const beats = graded.filter((r) => r.beat).length;
  const avgSurprise =
    graded
      .map((r) => r.surprise_pct)
      .filter((v): v is number => v != null && Number.isFinite(v));
  const avg =
    avgSurprise.length > 0
      ? avgSurprise.reduce((a, b) => a + b, 0) / avgSurprise.length
      : null;
  return `${beats}/${graded.length} beats in last ${graded.length} prints${
    avg != null ? ` · avg surprise ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%` : ""
  }`;
}

async function boardExposure(ticker: string): Promise<PreEarningsExposure | null> {
  const { getZeroDteBoardPayload } = await import("@/lib/platform/zerodte-service");
  const board = await getZeroDteBoardPayload().catch(() => null);
  if (!board) return null;
  const ledger = board.ledger?.find((r) => r.ticker.toUpperCase() === ticker.toUpperCase());
  if (ledger) {
    return {
      on_board: true,
      status: ledger.status ?? null,
      direction: ledger.direction ?? null,
      pnl_pct: ledger.live_pnl_pct ?? ledger.plan_pnl_pct ?? null,
      headline: `${ledger.direction} · ${ledger.status ?? "OPEN"}`,
    };
  }
  const setup = board.setups?.find((s) => s.ticker.toUpperCase() === ticker.toUpperCase());
  if (setup) {
    return {
      on_board: false,
      status: setup.gate?.verdict === "BLOCKED" ? "BLOCKED" : "WATCH",
      direction: setup.direction,
      pnl_pct: null,
      headline: `${setup.direction} setup · score ${setup.score}`,
    };
  }
  return { on_board: false, status: null, direction: null, pnl_pct: null, headline: null };
}

/** Bundle pre-earnings desk pack for Largo prefetch. */
export async function preEarningsPackForLargo(
  ticker: string,
  earningsDate?: string | null
): Promise<PreEarningsPackCard | null> {
  const t = String(ticker).trim().toUpperCase();
  if (!t) return null;

  const today = todayEtYmd();
  const [{ getGexPositioning }, { marketPlatform }, nextEarnings, historyRows, earningsSnap, zerodte] =
    await Promise.all([
      import("@/lib/providers/gex-positioning"),
      import("@/lib/platform"),
      fetchNextEarningsDate(t).catch(() => null),
      fetchUwTickerEarningsHistory(t, 6).catch(() => [] as Record<string, unknown>[]),
      readGridEarnings().catch(() => null),
      boardExposure(t),
    ]);

  const resolvedDate =
    earningsDate?.slice(0, 10) ??
    nextEarnings?.earnings_date ??
    matchEarnings(earningsSnap?.items ?? [], { today, nextDay: nextTradingDayEt(today) }).get(t)
      ?.report_date ??
    null;

  const calendarItem = (earningsSnap?.items ?? []).find((i) => i.ticker === t);
  const expectedMove =
    calendarItem?.expected_move_pct ??
    (historyRows[0] ? parseSurprise(historyRows[0]).expected_move_pct : null);

  const [pos, flowRes] = await Promise.all([
    getGexPositioning(t).catch(() => null),
    marketPlatform.flows.getFlowTapeSummary({ limit: 40, ticker: t }).catch(() => null),
  ]);

  let callPrem = 0;
  let putPrem = 0;
  const recent = (flowRes as { recent?: Array<{ premium?: number; option_type?: string }> } | null)?.recent ?? [];
  for (const row of recent) {
    const prem = Number(row.premium ?? 0);
    if (!Number.isFinite(prem)) continue;
    if (/call/i.test(String(row.option_type ?? ""))) callPrem += prem;
    else if (/put/i.test(String(row.option_type ?? ""))) putPrem += prem;
  }
  const net = callPrem - putPrem;
  const total = callPrem + putPrem;
  const flowBias =
    total < 1 ? "unknown" : net / total > 0.15 ? "bullish" : net / total < -0.15 ? "bearish" : "neutral";
  const flowSummary =
    flowBias === "bullish"
      ? "Net call premium into the print"
      : flowBias === "bearish"
        ? "Net put premium into the print"
        : flowBias === "neutral"
          ? "Balanced flow ahead of earnings"
          : "Insufficient flow in window";

  const history = historyRows.map((r) => parseSurprise(r));

  return roundFloats({
    kind: "pre_earnings",
    ticker: t,
    earnings_date: resolvedDate,
    days_until: nextEarnings?.days_until ?? null,
    report_time: nextEarnings?.report_time ?? calendarItem?.when ?? null,
    is_confirmed: nextEarnings?.is_confirmed ?? null,
    expected_move_pct: expectedMove,
    positioning: {
      available: pos != null,
      flip: pos?.flip ?? null,
      call_wall: pos?.call_wall ?? null,
      put_wall: pos?.put_wall ?? null,
      spot: pos?.spot ?? null,
      gamma_regime: pos?.gamma_regime_read != null ? String(pos.gamma_regime_read) : null,
    },
    flow: {
      available: flowRes != null,
      bias: flowBias,
      summary: flowSummary,
      net_premium: total >= 1 ? net : null,
    },
    history: history.slice(0, 6),
    history_summary: historySummary(history),
    zerodte,
    nighthawk: null,
    as_of: new Date().toISOString(),
  });
}
