/**
 * Pre-earnings desk pack — one intent bundles positioning, flow, history, board exposure.
 * Calendar/history from Benzinga; expected move from Polygon chain IV (no UW earnings REST).
 */

import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import { weekdayEt } from "@/lib/largo/temporal/session-calendar";
import { loadMeridianEarningsPrintHistory } from "@/lib/meridian/meridian-earnings-history";
import { loadEarningsExpectedMovePct } from "@/lib/meridian/meridian-earnings-expected-move";
import {
  loadBenzingaTickerEarnings,
  loadNextEarningsFromBenzinga,
} from "@/lib/meridian/meridian-benzinga-earnings";
import { parseNextEarningsFromBenzinga } from "@/lib/meridian/meridian-benzinga-earnings-core";
import {
  toPreEarningsHistoryRows,
  type PreEarningsHistoryRow,
} from "@/lib/largo/pre-earnings-history-rows";

export type { PreEarningsHistoryRow };

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
  /**
   * Non-null when the earnings-calendar fetch FAILED. An empty `history` with a null error means
   * the company genuinely has no prints on file; an empty `history` WITH an error means we could
   * not look. Collapsing those two into one empty array is how "we don't know" gets reported as
   * "there is nothing".
   */
  history_error: string | null;
  zerodte: PreEarningsExposure | null;
  /**
   * ET-ANCHORED, not a bare UTC instant. Every date on this card is an ET SESSION — the report
   * date, the print timing, the reaction window — and all of them are read against "today". A
   * reader handed `2026-08-21T03:12:00.000Z` at 23:12 ET on 2026-08-20 has to INFER which session
   * that is, and in production a model did exactly that inference and landed a full session out.
   */
  as_of: string;
  /**
   * The ET session date this card was built on, and its weekday. The weekday is not decoration:
   * BMO/AMC reasoning is weekday reasoning — "the next session" after a Friday AMC print is
   * Monday, not Saturday — and a model got a weekday wrong in production on this very surface.
   */
  as_of_session: string;
  as_of_weekday: string;
};

function historySummary(rows: PreEarningsHistoryRow[]): string | null {
  const graded = rows.filter((r) => r.beat != null);
  if (!graded.length) return null;
  const beats = graded.filter((r) => r.beat).length;
  const avgSurprise = graded
    .map((r) => r.surprise_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avg =
    avgSurprise.length > 0 ? avgSurprise.reduce((a, b) => a + b, 0) / avgSurprise.length : null;
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

/** Bundle pre-earnings desk pack for Largo / Meridian prefetch. */
export async function preEarningsPackForLargo(
  ticker: string,
  earningsDate?: string | null
): Promise<PreEarningsPackCard | null> {
  const t = String(ticker).trim().toUpperCase();
  if (!t) return null;

  const today = todayEtYmd();
  const [{ getGexPositioning }, { marketPlatform }, benzingaRes, nextEarnings, zerodte] =
    await Promise.all([
      import("@/lib/providers/gex-positioning"),
      import("@/lib/platform"),
      loadBenzingaTickerEarnings(t, earningsDate ?? null),
      loadNextEarningsFromBenzinga(t).catch(() => null),
      boardExposure(t),
    ]);

  const parsedNext = parseNextEarningsFromBenzinga(t, benzingaRes.rows, today);
  const next = parsedNext ?? nextEarnings;
  const resolvedDate =
    earningsDate?.slice(0, 10) ?? next?.earnings_date ?? null;

  const [historyRes, expected_move_pct, pos, flowRes] = await Promise.all([
    loadMeridianEarningsPrintHistory(t, 6, resolvedDate),
    loadEarningsExpectedMovePct(t, resolvedDate),
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

  // Carry the REACTION and its BASIS through — see pre-earnings-history-rows.ts for why this
  // projection is a separate, tested module rather than an inline .map().
  const history = toPreEarningsHistoryRows(historyRes.print_history, 6);

  return roundFloats({
    kind: "pre_earnings",
    ticker: t,
    earnings_date: resolvedDate,
    days_until: next?.days_until ?? null,
    report_time: next?.report_time ?? null,
    is_confirmed: next?.is_confirmed ?? null,
    expected_move_pct,
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
    history,
    history_summary: historyRes.print_history_summary ?? historySummary(history),
    history_error: historyRes.history_error ?? null,
    zerodte,
    // `nighthawk` is deliberately GONE rather than hardcoded to null. It was declared, never
    // populated, and never read by any consumer — so its only effect was to tell a model that
    // Night Hawk exposure had been checked and found absent, when it had never been looked up.
    // A field that implies a measurement nobody took is worse than no field.
    as_of: etStamp(Date.now()) ?? new Date().toISOString(),
    as_of_session: today,
    as_of_weekday: weekdayEt(today),
  });
}
