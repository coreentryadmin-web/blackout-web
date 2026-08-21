/**
 * THE IRON CONDOR'S OWN RECORD — separated from the directional 0DTE record on purpose.
 *
 * ── WHY THIS IS A SEPARATE LANE ──────────────────────────────────────────────────────────────
 *
 * A directional 0DTE play and a sold iron condor are opposite instruments. The directional record
 * grades WIN = positive realized P&L and lives on ~40-50% hit / big-payoff economics. A condor is
 * graded WIN = price closed INSIDE both short strikes, LOSS = a breach of the defined-risk cap —
 * ~80% small credits, ~20% bigger (defined) losses. Blending the two into one P&L-sign win rate
 * averages two opposite skews into a number that describes neither.
 *
 * Condors persist into the SAME `zerodte_setup_log` the directional record reads
 * (`entry_context.play_type === "CONDOR"`, graded to `condor_win` / `condor_breach_loss`), and
 * `buildZeroDteRecord` never filtered by play_type — so the moment a condor commits, it would
 * contaminate the headline directional win rate. Measured 2026-08-21: ZERO condors have committed
 * in the last 90 days (the engine is flag-ON but PIN-sourced and evidently rarely/never qualifies),
 * so the contamination is currently LATENT — this separates the lanes before it isn't.
 *
 * ── AND IT MAKES THE BACKTESTED NUMBERS HONEST ───────────────────────────────────────────────
 *
 * get_zerodte_plays now surfaces the condor's BACKTESTED characteristics (77-92% by width). A
 * member who sees that will ask "and how has it actually done?" With no realized record, the only
 * honest answer is "it has not traded live in this window" — stated explicitly here, next to the
 * backtested descriptor, so the backtest is never mistaken for a live track record.
 */

/** A condor row is tagged by its pinned play_type; anything else is directional. */
export function isCondorRow(entry_context: Record<string, unknown> | null | undefined): boolean {
  return !!entry_context && (entry_context as { play_type?: unknown }).play_type === "CONDOR";
}

export type CondorRecord = {
  /** All condor rows committed in the window (graded or not). */
  committed: number;
  /** Rows with a terminal condor grade (condor_win or condor_breach_loss). */
  graded: number;
  /** Closed INSIDE both short strikes — the credit was kept. */
  wins: number;
  /** Breached a short strike — the defined-loss cap was taken. */
  breach_losses: number;
  /** win / graded — the REALIZED win rate, to sit beside the backtested win-rate-by-width. */
  win_rate_pct: number | null;
  /** breach_losses / graded — the REALIZED intraday-breach rate, to compare against the
   *  backtested ~18.7% companion. A live number, not a model estimate. */
  breach_rate_pct: number | null;
  /** Average realized P&L % across graded condors (credit kept on wins, defined loss on breaches). */
  avg_pnl_pct: number | null;
  /** True when the engine is armed but nothing committed — the honest "no live record" state. */
  no_live_record: boolean;
  note: string;
};

type CondorGradableRow = {
  plan_outcome: string | null;
  plan_pnl_pct: number | null;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Build the condor lane's record from its rows. Kept pure and separate so it can never disturb the
 * directional numbers, and so a model quoting it cannot pair a condor breach with a directional
 * win rate.
 */
export function buildCondorRecord(rows: CondorGradableRow[]): CondorRecord {
  const graded = rows.filter(
    (r) => r.plan_outcome === "condor_win" || r.plan_outcome === "condor_breach_loss"
  );
  const wins = graded.filter((r) => r.plan_outcome === "condor_win").length;
  const breaches = graded.filter((r) => r.plan_outcome === "condor_breach_loss").length;
  const pnls = graded.map((r) => r.plan_pnl_pct).filter((p): p is number => typeof p === "number" && Number.isFinite(p));

  const note =
    rows.length === 0
      ? "No iron condor has committed in this window. The condor engine is armed (flag-on) but " +
        "PIN-sourced and evidently rarely qualifies — it has NO realized track record here. Its " +
        "BACKTESTED characteristics (win-rate-by-width, the ~18.7% intraday-breach companion) are " +
        "in get_zerodte_plays `iron_condor`; do not present the backtest as live performance."
      : graded.length === 0
        ? `${rows.length} condor(s) committed but none have a terminal grade yet — no realized rate to quote.`
        : `${graded.length} condor(s) graded: ${wins} closed inside (win), ${breaches} breached the ` +
          `defined-risk cap. This is the REALIZED record — compare its breach rate against the ` +
          `backtested ~18.7% companion, not the backtested win rate.`;

  return {
    committed: rows.length,
    graded: graded.length,
    wins,
    breach_losses: breaches,
    win_rate_pct: graded.length > 0 ? round1((wins / graded.length) * 100) : null,
    breach_rate_pct: graded.length > 0 ? round1((breaches / graded.length) * 100) : null,
    avg_pnl_pct: pnls.length > 0 ? round1(pnls.reduce((a, b) => a + b, 0) / pnls.length) : null,
    no_live_record: graded.length === 0,
    note,
  };
}
