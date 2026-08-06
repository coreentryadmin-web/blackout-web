import { buildPublicTrackRecord, type PublicTrackRecord } from "@/lib/track-record-public";
import type { BieComposed } from "@/lib/bie/composers-shared";

type ProductComparison = {
  days: number;
  spx_win_rate: number;
  spx_signal_count: number;
  nighthawk_win_rate: number;
  nighthawk_signal_count: number;
  nighthawk_pending_count: number;
  /** wins + losses — the n that actually produced nighthawk_win_rate. */
  nighthawk_decided?: number;
  nighthawk_wins?: number;
  nighthawk_losses?: number;
  /** Scoreable rows whose grading horizon expired without touching target or stop. */
  nighthawk_opens?: number;
  /** nighthawk_decided < LOW_N_THRESHOLD — the rate must not be quoted at all. */
  nighthawk_low_n?: boolean;
  win_rate_delta: number;
  note?: string;
};

/** Deterministic track-record read for Largo BIE — public SPX aggregates + cross-product window stats. */
export async function composeRecordRead(): Promise<BieComposed> {
  const { runLargoTool } = await import("@/lib/largo/run-tool");
  const [record, comparison] = await Promise.all([
    buildPublicTrackRecord(),
    runLargoTool("get_spx_vs_nighthawk_comparison", { days: 30 }).catch(() => null) as Promise<
      ProductComparison | null
    >,
  ]);
  return {
    answer: formatRecordAnswer(record, comparison),
    context: { record, comparison },
  };
}

function pctRate(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

/** The Night Hawk line of the cross-product comparison.
 *
 *  This sentence used to read "Night Hawk: 0% win rate · 22 graded pick(s)" to paying
 *  members — the 0% was computed over DECIDED outcomes (0 wins / 2 losses) while the 22 was
 *  the scoreable row count, so the two halves came from different populations and together
 *  implied 0-for-22. Neither number was defensible: 20 of those 22 plays never touched their
 *  target OR their stop, so the product had two decided outcomes, not twenty-two losses.
 *
 *  Below the decided-outcome floor we quote NO rate at all — only the raw counts, which are
 *  honest at any sample size. This states strictly less than the old line, never more. */
function nighthawkLine(c: ProductComparison): string {
  const pending = c.nighthawk_pending_count > 0 ? ` · ${c.nighthawk_pending_count} still pending` : "";
  if (c.nighthawk_low_n) {
    const wins = c.nighthawk_wins ?? 0;
    const losses = c.nighthawk_losses ?? 0;
    const opens = c.nighthawk_opens ?? 0;
    const noTouch = opens > 0 ? ` (${opens} closed without touching target or stop)` : "";
    return (
      `- Night Hawk: insufficient decided sample — ${wins} win(s) / ${losses} loss(es) ` +
      `over ${c.nighthawk_signal_count} scoreable pick(s)${noTouch}${pending}`
    );
  }
  const decided = c.nighthawk_decided ?? c.nighthawk_signal_count;
  return `- Night Hawk: ${pctRate(c.nighthawk_win_rate)} win rate · ${decided} decided pick(s) of ${c.nighthawk_signal_count} scoreable${pending}`;
}

export function formatRecordAnswer(
  r: PublicTrackRecord,
  comparison: ProductComparison | null = null
): string {
  const lines = ["**Platform track record**", ""];

  lines.push("**SPX Slayer (published aggregate)**");
  if (!r.available || r.total_closed <= 0) {
    lines.push(
      "No closed plays in the published record yet — the desk is still building history."
    );
  } else {
    lines.push(
      `Closed plays: **${r.total_closed.toLocaleString()}** over ~**${r.days_of_data}** session day(s)`,
      `Win rate: **${r.win_rate_pct}%** (${r.wins}W / ${r.losses}L / ${r.breakeven}BE)`,
      "",
      "By path:",
      `- Cold buy: ${r.paths.cold_buy.count} plays · ${r.paths.cold_buy.win_rate_pct}% win · avg MFE ${r.paths.cold_buy.avg_mfe_pts} pts`,
      `- Watch → promote: ${r.paths.watch_promote.count} plays · ${r.paths.watch_promote.win_rate_pct}% win · avg MFE ${r.paths.watch_promote.avg_mfe_pts} pts`,
      `Adaptive gating: **${r.adaptive_active ? "active" : "standby"}**`,
      r.summary ? `Summary: ${r.summary}` : ""
    );
  }

  if (comparison && comparison.spx_signal_count + comparison.nighthawk_signal_count > 0) {
    lines.push(
      "",
      `**SPX Slayer vs Night Hawk (${comparison.days}-day rolling window)**`,
      `- SPX Slayer: ${pctRate(comparison.spx_win_rate)} win rate · ${comparison.spx_signal_count} closed signal(s)`,
      nighthawkLine(comparison),
      // The delta is a difference of two rates; it is meaningless (and reads as a hard
      // verdict) when one side has no readable sample. Suppressed rather than rounded.
      comparison.nighthawk_low_n
        ? "- Win-rate delta (SPX − NH): not computable — Night Hawk has no readable decided sample yet"
        : `- Win-rate delta (SPX − NH): **${comparison.win_rate_delta >= 0 ? "+" : ""}${Math.round(comparison.win_rate_delta * 100)} pts**`,
      comparison.note ? `_${comparison.note}_` : ""
    );
  } else {
    lines.push(
      "",
      "**Night Hawk / cross-product comparison:** not enough graded history in the last 30 days to quote side-by-side stats."
    );
  }

  lines.push(
    "",
    "_BIE read from the same aggregations as `/track-record` — aggregate stats only, no per-trade rows or live trade advice._"
  );

  return lines.filter(Boolean).join("\n");
}
