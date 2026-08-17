import "server-only";

import { fetchUwTickerEarningsHistory } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import { stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import {
  benzingaRowsToPrintHistory,
  dualBeatRateFromPrints,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import { loadBenzingaTickerEarnings } from "@/lib/meridian/meridian-benzinga-earnings";
import type { MeridianEarningsPrint } from "@/features/meridian/lib/meridian-types";

function parseExpectedMovePct(row: Record<string, unknown>): number | null {
  const emRaw = row.expected_move_perc ?? row.expected_move_pct ?? null;
  if (emRaw == null || !Number.isFinite(Number(emRaw))) return null;
  const n = Number(emRaw);
  return Number((n * (n <= 1 ? 100 : 1)).toFixed(1));
}

function parseUwPrint(row: Record<string, unknown>): Omit<
  MeridianEarningsPrint,
  "session_change_pct" | "next_day_change_pct"
> {
  const est = row.street_mean_est ?? row.eps_estimate ?? row.estimate ?? null;
  const act = row.actual_eps ?? row.eps_actual ?? row.actual ?? null;
  const estN = est != null ? Number(est) : null;
  const actN = act != null ? Number(act) : null;
  let surprise_pct: number | null = null;
  let beat: boolean | null = null;
  if (estN != null && actN != null && estN !== 0) {
    surprise_pct = Number((((actN - estN) / Math.abs(estN)) * 100).toFixed(1));
    beat = actN >= estN;
  } else if (row.surprise_pct != null && Number.isFinite(Number(row.surprise_pct))) {
    surprise_pct = Number(row.surprise_pct);
    beat = surprise_pct >= 0;
  }
  const report_date =
    String(row.report_date ?? row.earnings_date ?? row.date ?? "").slice(0, 10) || null;
  return {
    report_date,
    eps_estimate: estN != null && Number.isFinite(estN) ? Number(estN.toFixed(2)) : null,
    eps_actual: actN != null && Number.isFinite(actN) ? Number(actN.toFixed(2)) : null,
    surprise_pct,
    beat,
    expected_move_pct: parseExpectedMovePct(row),
    source: "uw",
  };
}

function printHistorySummary(rows: MeridianEarningsPrint[]): string | null {
  const graded = rows.filter((r) => r.beat != null);
  if (!graded.length) return null;
  const beats = graded.filter((r) => r.beat).length;
  const rates = dualBeatRateFromPrints(rows);
  const withMove = rows.filter((r) => r.session_change_pct != null);
  const avgMove =
    withMove.length > 0
      ? withMove.reduce((s, r) => s + (r.session_change_pct ?? 0), 0) / withMove.length
      : null;
  const base = `${beats}/${graded.length} EPS beats over last ${graded.length} prints`;
  const rev =
    rates.revenue_beat_rate != null
      ? ` · ${Math.round(rates.revenue_beat_rate * 100)}% rev beats`
      : "";
  if (avgMove == null) return base + rev;
  return `${base}${rev} · avg session move ${avgMove >= 0 ? "+" : ""}${avgMove.toFixed(1)}%`;
}

function overlayUwExpectedMove(
  prints: MeridianEarningsPrint[],
  uwRows: Record<string, unknown>[]
): MeridianEarningsPrint[] {
  const emByDate = new Map<string, number | null>();
  for (const row of uwRows) {
    const p = parseUwPrint(row);
    if (p.report_date) emByDate.set(p.report_date, p.expected_move_pct);
  }
  return prints.map((p) => ({
    ...p,
    expected_move_pct: p.report_date ? emByDate.get(p.report_date) ?? p.expected_move_pct : p.expected_move_pct,
  }));
}

/** Past earnings prints — Benzinga calendar primary, UW overlay for implied move into print. */
export async function loadMeridianEarningsPrintHistory(
  ticker: string,
  limit = 8,
  eventDate?: string | null
): Promise<{ print_history: MeridianEarningsPrint[]; print_history_summary: string | null }> {
  const sym = ticker.trim().toUpperCase();
  const [benzingaRes, uwRows] = await Promise.all([
    loadBenzingaTickerEarnings(sym, eventDate ?? null),
    fetchUwTickerEarningsHistory(sym, limit + 2).catch(() => [] as Record<string, unknown>[]),
  ]);

  let print_history = benzingaRowsToPrintHistory(benzingaRes.rows, limit);

  if (!print_history.length) {
    print_history = uwRows
      .map((r) => parseUwPrint(r as Record<string, unknown>))
      .filter((r) => r.report_date)
      .sort((a, b) => (b.report_date ?? "").localeCompare(a.report_date ?? ""))
      .slice(0, limit) as MeridianEarningsPrint[];
  } else {
    print_history = overlayUwExpectedMove(print_history, uwRows as Record<string, unknown>[]);
  }

  const dates = print_history.map((p) => p.report_date!).filter(Boolean);
  const reactions = await stockReactionsForDates(sym, dates);

  print_history = print_history.map((p) => {
    const rx = p.report_date ? reactions.get(p.report_date) : undefined;
    return {
      ...p,
      session_change_pct: rx?.session_change_pct ?? null,
      next_day_change_pct: rx?.next_day_change_pct ?? null,
    };
  });

  return roundFloats({
    print_history,
    print_history_summary: printHistorySummary(print_history),
  });
}
