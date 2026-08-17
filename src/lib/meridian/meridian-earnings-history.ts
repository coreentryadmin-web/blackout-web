import "server-only";

import { fetchUwTickerEarningsHistory } from "@/lib/providers/unusual-whales";
import { roundFloats } from "@/lib/round-floats";
import { stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import type { MeridianEarningsPrint } from "@/features/meridian/lib/meridian-types";

function parseExpectedMovePct(row: Record<string, unknown>): number | null {
  const emRaw = row.expected_move_perc ?? row.expected_move_pct ?? null;
  if (emRaw == null || !Number.isFinite(Number(emRaw))) return null;
  const n = Number(emRaw);
  return Number((n * (n <= 1 ? 100 : 1)).toFixed(1));
}

function parseEarningsPrint(row: Record<string, unknown>): Omit<
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
  };
}

function printHistorySummary(rows: MeridianEarningsPrint[]): string | null {
  const graded = rows.filter((r) => r.beat != null);
  if (!graded.length) return null;
  const beats = graded.filter((r) => r.beat).length;
  const withMove = rows.filter((r) => r.session_change_pct != null);
  const avgMove =
    withMove.length > 0
      ? withMove.reduce((s, r) => s + (r.session_change_pct ?? 0), 0) / withMove.length
      : null;
  const base = `${beats}/${graded.length} beats over last ${graded.length} prints`;
  if (avgMove == null) return base;
  return `${base} · avg session move ${avgMove >= 0 ? "+" : ""}${avgMove.toFixed(1)}%`;
}

/** Past earnings prints with estimate vs actual and stock session reaction. */
export async function loadMeridianEarningsPrintHistory(
  ticker: string,
  limit = 6
): Promise<{ print_history: MeridianEarningsPrint[]; print_history_summary: string | null }> {
  const sym = ticker.trim().toUpperCase();
  const rows = await fetchUwTickerEarningsHistory(sym, limit + 2).catch(() => []);
  const parsed = rows
    .map((r) => parseEarningsPrint(r as Record<string, unknown>))
    .filter((r) => r.report_date)
    .sort((a, b) => (b.report_date ?? "").localeCompare(a.report_date ?? ""))
    .slice(0, limit);

  const dates = parsed.map((p) => p.report_date!).filter(Boolean);
  const reactions = await stockReactionsForDates(sym, dates);

  const print_history: MeridianEarningsPrint[] = parsed.map((p) => {
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
