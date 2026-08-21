/**
 * What P&L number should the MODEL be given for a banger position?
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE (measured in production 2026-08-21) ──────────────────────
 *
 * `bangerBoardForLargo` gave every row one field, `live_pnl_pct`, computed as
 * `(last_mark - entry_premium) / entry_premium`, and used the row's own `realized_pnl_pct` only
 * as a fallback for when that arithmetic was impossible. On a CLOSED row that is the wrong
 * number, under a name — "live" — that tells the model it is looking at an open position.
 *
 * `last_mark` on a closed banger is the last mark of the REMAINING leg. `realized_pnl_pct` is
 * frozen at the terminal transition from the same arithmetic `gradeScaleOut` uses — the banked
 * partial tranche PLUS the remainder at exit — and `live-sync.ts` says why in as many words:
 * so that "the live ledger and the offline grader can never silently diverge on what 'realized'
 * means". Largo, the one surface that states these numbers in prose to a member, was the single
 * consumer that diverged from it. The member's own board (`BangerBoard.tsx`) renders
 * `realized_pnl_pct`; the API that feeds it ships `realized_pnl_pct`. Only the tool dropped it.
 *
 * All eight closed rows on the live board disagreed, every one of them UNDERSTATING:
 *
 *     BKKT  CLOSED_RUNNER  realized  +85.00%   mark-derived  +72.0%   (-13.0pp)
 *     WRBY  CLOSED_RUNNER  realized  +32.69%   mark-derived  -33.8%   (-66.5pp)  ← sign flipped
 *     VKTX  CLOSED_RUNNER  realized  +50.00%   mark-derived    0.0%   (-50.0pp)
 *     GLXY  CLOSED_RUNNER  realized  +78.99%   mark-derived  +58.0%   (-21.0pp)
 *     BULL  CLOSED_RUNNER  realized  +58.13%   mark-derived  +17.5%   (-40.6pp)
 *     CPNG  STOPPED        realized  -60.00%   mark-derived  -64.7%    (-4.7pp)
 *     SMR   STOPPED        realized  -60.00%   mark-derived  -60.9%    (-0.9pp)
 *     TSLL  STOPPED        realized  -60.00%   mark-derived  -62.2%    (-2.2pp)
 *
 * The five large errors are exactly the five rows with `scaled_already` — the trim is banked in
 * `realized_pnl_pct` and invisible to `last_mark`. WRBY is the case that matters most: a member
 * asking Largo about a closed WINNER would have been told it lost a third of its premium.
 *
 * ── WHY IT IS FIXED HERE AND NOT IN THE PROVIDER ─────────────────────────────────────────────
 *
 * `src/lib/banger/**` is right: it stores both numbers and means different things by them. The
 * board API is right: it ships both and lets the renderer choose. The mistake was made at the
 * MODEL'S TOOL BOUNDARY, by collapsing two different quantities into one field whose name only
 * described one of them — so that is where it is corrected, with no provider touched and no
 * trading behaviour anywhere near it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 *
 * A number is emitted under a name that says what it MEASURES, and never under a name that says
 * something else. When the honest number is absent, the field is absent and says so — a closed
 * row with no `realized_pnl_pct` does not get a mark-to-market stand-in wearing its clothes.
 */

/** The subset of a banger row this needs. Structural, so a caller can pass the full row. */
export type BangerPnlInput = {
  status: string;
  entry_premium: number | null;
  last_mark: number | null;
  scaled_already?: boolean;
  realized_pnl_pct: number | null;
};

export type BangerPnlView = {
  /** Mark-to-market on the position as it stands. OPEN/PARTIAL only — never on a closed row. */
  live_pnl_pct?: number;
  /** As-managed result: banked partial tranche + remainder at exit. CLOSED rows only. */
  realized_pnl_pct?: number;
  /** What the number above actually measures. Always present, so the model never has to infer. */
  pnl_basis: "mark_to_market" | "realized_as_managed" | "unknown";
  /** Present only when it changes how the number must be read. */
  pnl_note?: string;
};

const CLOSED_STATUSES = new Set(["CLOSED_RUNNER", "STOPPED"]);

export function isClosedBangerStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function bangerPnlForModel(row: BangerPnlInput): BangerPnlView {
  if (isClosedBangerStatus(row.status)) {
    if (row.realized_pnl_pct == null) {
      // ABSENCE, NOT EMPTINESS. A closed row whose realized figure never froze is a data gap.
      // Substituting the mark-to-market here is precisely the defect this module closes, so the
      // number is withheld and the gap is stated.
      return {
        pnl_basis: "unknown",
        pnl_note:
          "This position is closed but its realized P&L was never recorded. No P&L is reported " +
          "for it — do not compute one from entry_premium and last_mark: on a scaled position " +
          "that arithmetic ignores the banked tranche and understates the result.",
      };
    }
    return {
      realized_pnl_pct: row.realized_pnl_pct,
      pnl_basis: "realized_as_managed",
      pnl_note: row.scaled_already
        ? "Realized as managed: this position scaled out, so this figure blends the banked " +
          "tranche with the remainder at exit. It is NOT (last_mark - entry_premium)/entry_premium, " +
          "which sees only the remaining leg."
        : undefined,
    };
  }

  if (row.entry_premium == null || row.last_mark == null || row.entry_premium === 0) {
    return {
      pnl_basis: "unknown",
      pnl_note: "This position is open but has no current mark, so it has no P&L yet — not a flat one.",
    };
  }

  const live = ((row.last_mark - row.entry_premium) / row.entry_premium) * 100;
  return {
    live_pnl_pct: live,
    pnl_basis: "mark_to_market",
    pnl_note: row.scaled_already
      ? "Mark-to-market on the REMAINING leg only. This position has already scaled out, so a " +
        "tranche is banked that this figure does not include — the eventual realized result will " +
        "be higher than this number implies."
      : undefined,
  };
}
