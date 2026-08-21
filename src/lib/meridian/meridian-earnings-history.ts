import "server-only";

import { roundFloats } from "@/lib/round-floats";
import { stockReactionsForPrints } from "@/lib/meridian/meridian-reaction";
import { classifyPrintTiming } from "@/lib/meridian/meridian-reaction-core";
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
  // `reaction_pct`, not `session_change_pct`: on a post-close print the latter is the anchor
  // session's open→close, which excludes the overnight gap that IS the reaction. Averaging it
  // produced a headline "avg session move" that disagreed in sign with the market on ~a third
  // of post-close prints.
  const withMove = rows.filter((r) => r.reaction_pct != null);
  const avgMove =
    withMove.length > 0
      ? withMove.reduce((s, r) => s + (r.reaction_pct ?? 0), 0) / withMove.length
      : null;
  const base = `${beats}/${graded.length} EPS beats over last ${graded.length} prints`;
  const rev =
    rates.revenue_beat_rate != null
      ? ` · ${Math.round(rates.revenue_beat_rate * 100)}% rev beats`
      : "";
  if (avgMove == null) return base + rev;
  return `${base}${rev} · avg reaction ${avgMove >= 0 ? "+" : ""}${avgMove.toFixed(1)}%`;
}

/** Past earnings prints — Benzinga calendar primary (no UW earnings REST). */
export async function loadMeridianEarningsPrintHistory(
  ticker: string,
  limit = 8,
  eventDate?: string | null
): Promise<{
  print_history: MeridianEarningsPrint[];
  print_history_summary: string | null;
  /** Non-null when the calendar fetch FAILED. Empty history + a null error means the company
   *  genuinely has no prints on file; empty history + an error means we could not look. */
  history_error: string | null;
}> {
  const sym = ticker.trim().toUpperCase();
  // Forward the count we actually need: the loader derives its LOOKBACK WINDOW from it. Pinned at
  // 420 days, the window was ~4.6 quarters, so asking for 8 prints returned 4-5 (measured live).
  const benzingaRes = await loadBenzingaTickerEarnings(sym, eventDate ?? null, limit);

  const print_history = benzingaRowsToPrintHistory(benzingaRes.rows, limit);

  // Timing-aware: an AMC print's reaction is the NEXT session, not the report date's own.
  const printKeys = print_history
    .filter((p) => p.report_date)
    .map((p) => ({ ymd: p.report_date!, timing: classifyPrintTiming(p.report_time_et) }));
  const reactions = await stockReactionsForPrints(sym, printKeys);

  const enriched = print_history.map((p) => {
    const rx = p.report_date ? reactions.get(p.report_date) : undefined;
    return {
      ...p,
      session_change_pct: rx?.session_change_pct ?? null,
      next_day_change_pct: rx?.next_day_change_pct ?? null,
      reaction_basis: rx?.reaction_basis ?? null,
      reaction_pct: rx?.reaction_pct ?? null,
      reaction_measure: rx?.reaction_measure ?? null,
    };
  });

  return roundFloats({
    print_history: enriched,
    print_history_summary: printHistorySummary(enriched),
    history_error: (benzingaRes as { error?: string | null }).error ?? null,
  });
}
