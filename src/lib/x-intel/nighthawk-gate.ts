/**
 * NIGHT HAWK POST GATE — when 🦅 NIGHT HAWK STRIKE may be published at all.
 *
 * OPERATOR RULE, 2026-08-21, verbatim:
 *
 *   "we should only post for NH only winning plays like above 50% .. or green days where we had
 *    massive good 0DTE plays .. filtered by PnL"
 *
 * ── WHY THIS IS A GATE AND NOT AN EDITORIAL PREFERENCE ─────────────────────────────────────────
 *
 * Every other franchise is selected by what the market did. This one is selected by what BLACKOUT's
 * own trades did, which makes it the one place the account can accidentally publish a losing day
 * as though it were a feature. The Night Hawk board shows winners and losers in the same list —
 * the operator's own exemplar has +97% at the top and -23% at the bottom of the same session — so
 * "capture the closed tab" without a P&L filter is one screenshot away from advertising a loss.
 *
 * Enforced in code for the same reason the chronology rule is: a rule that lives only in a prompt
 * is a rule that survives exactly as long as the prompt is read carefully.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 *
 * It does not hide losses. A package may still REPORT a losing play — a 🧾 RECEIPTS or ⚔️ SIGNAL
 * CONFLICT post about a trade that did not work is honest and often more credible than another
 * winner. What the gate blocks is the specific act of running the 🦅 NIGHT HAWK STRIKE victory
 * format on a session that did not earn it. Cherry-picking one green play out of a red day is
 * exactly what `session_is_green` exists to catch: a single winner is not a green day, and the
 * gate asks for both.
 */

/** One closed Night Hawk play, as the board reports it. */
export type NightHawkClosedPlay = {
  ticker: string;
  /** e.g. "16.5C 0DTE". */
  contract: string;
  /** Realised P&L percent. Negative for a loss. */
  pnl_pct: number;
  /** "10:33→10:45" — present on a closed play, absent while it is still open. */
  window_et: string | null;
  grade: string | null;
};

/** The threshold a single play must clear to headline a NIGHT HAWK STRIKE post. */
export const NIGHT_HAWK_WINNER_THRESHOLD_PCT = 50;

export type NightHawkGateInput = {
  closed: ReadonlyArray<NightHawkClosedPlay>;
  /**
   * Whether the SESSION as a whole finished green, from the board's own P&L readout — NOT derived
   * by summing `closed`, because the board's figure is R-weighted and position-sized while the
   * list is a per-play percentage. Recomputing it here would produce a second, disagreeing number
   * for the same fact, which is the defect class this repo keeps paying for.
   *
   * Null when it could not be read. Null is NOT false: an unknown session P&L must block the post
   * rather than silently pass the "green day" branch.
   */
  session_pnl_r: number | null;
};

export type NightHawkGateVerdict =
  | { publishable: true; headline_play: NightHawkClosedPlay; basis: string }
  | { publishable: false; reason: string };

/**
 * Whether a NIGHT HAWK STRIKE package may be built from this session.
 *
 * Requires BOTH a genuine winner and a session that did not lose. The conjunction is the point:
 * a +90% play inside a red day is a cherry-pick, and a green day with no standout play has nothing
 * to show that a reader would stop scrolling for.
 */
export function nightHawkPostGate(input: NightHawkGateInput): NightHawkGateVerdict {
  const closed = input.closed.filter((p) => Number.isFinite(p.pnl_pct));

  if (!closed.length) {
    return { publishable: false, reason: "no closed Night Hawk plays this session" };
  }

  if (input.session_pnl_r == null) {
    // Absence is a finding, not a pass.
    return {
      publishable: false,
      reason: "session P&L could not be read — refusing to claim a green day we did not measure",
    };
  }

  if (input.session_pnl_r < 0) {
    const best = bestPlay(closed);
    return {
      publishable: false,
      reason: `session finished red (${input.session_pnl_r.toFixed(1)}R) — a ${best.pnl_pct >= 0 ? `+${best.pnl_pct}%` : `${best.pnl_pct}%`} play inside a losing day is a cherry-pick, not a strike`,
    };
  }

  const winners = closed.filter((p) => p.pnl_pct > NIGHT_HAWK_WINNER_THRESHOLD_PCT);
  if (!winners.length) {
    const best = bestPlay(closed);
    return {
      publishable: false,
      reason: `no closed play above +${NIGHT_HAWK_WINNER_THRESHOLD_PCT}% (best was ${best.ticker} ${best.pnl_pct >= 0 ? "+" : ""}${best.pnl_pct}%)`,
    };
  }

  const headline = bestPlay(winners);
  const others = winners.length - 1;
  return {
    publishable: true,
    headline_play: headline,
    basis:
      `${headline.ticker} ${headline.contract} closed ${headline.pnl_pct >= 0 ? "+" : ""}${headline.pnl_pct}%` +
      (others > 0 ? ` with ${others} other play${others === 1 ? "" : "s"} over +${NIGHT_HAWK_WINNER_THRESHOLD_PCT}%` : "") +
      `, session ${input.session_pnl_r >= 0 ? "+" : ""}${input.session_pnl_r.toFixed(1)}R`,
  };
}

function bestPlay(plays: ReadonlyArray<NightHawkClosedPlay>): NightHawkClosedPlay {
  return plays.reduce((a, b) => (b.pnl_pct > a.pnl_pct ? b : a));
}

/**
 * The winners worth putting in frame, best first.
 *
 * Capped, because the operator's exemplar shows a CLOSED list running from +97% to -23% in one
 * session — a screenshot of the whole tab publishes the losses alongside the wins. The frame is
 * the winning stack, and the post says how many plays the session had in total so the reader is
 * not left to infer that the board held only winners. Reporting the denominator is the difference
 * between a track record and a highlight reel.
 */
export function headlineWinners(
  closed: ReadonlyArray<NightHawkClosedPlay>,
  limit = 8,
): NightHawkClosedPlay[] {
  return [...closed]
    .filter((p) => p.pnl_pct > NIGHT_HAWK_WINNER_THRESHOLD_PCT)
    .sort((a, b) => b.pnl_pct - a.pnl_pct)
    .slice(0, Math.max(1, limit));
}
