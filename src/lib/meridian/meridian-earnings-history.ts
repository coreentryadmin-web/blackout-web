import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { stockReactionsForDates } from "@/lib/meridian/meridian-reaction";
import {
  benzingaRowsToPrintHistory,
  dualBeatRateFromPrints,
} from "@/lib/meridian/meridian-benzinga-earnings-core";
import { loadBenzingaTickerEarnings } from "@/lib/meridian/meridian-benzinga-earnings";
import type { MeridianEarningsPrint } from "@/features/meridian/lib/meridian-types";

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

/** Past earnings prints — Benzinga calendar primary (no UW earnings REST). */
export async function loadMeridianEarningsPrintHistory(
  ticker: string,
  limit = 8,
  eventDate?: string | null
): Promise<{ print_history: MeridianEarningsPrint[]; print_history_summary: string | null }> {
  const sym = ticker.trim().toUpperCase();
  const benzingaRes = await loadBenzingaTickerEarnings(sym, eventDate ?? null);

  const print_history = benzingaRowsToPrintHistory(benzingaRes.rows, limit);

  const dates = print_history.map((p) => p.report_date!).filter(Boolean);
  const reactions = await stockReactionsForDates(sym, dates);

  const enriched = print_history.map((p) => {
    const rx = p.report_date ? reactions.get(p.report_date) : undefined;
    return {
      ...p,
      session_change_pct: rx?.session_change_pct ?? null,
      next_day_change_pct: rx?.next_day_change_pct ?? null,
    };
  });

  return roundFloats({
    print_history: enriched,
    print_history_summary: printHistorySummary(enriched),
  });
}
