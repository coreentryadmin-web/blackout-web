/**
 * Project Meridian's print history down to the rows the Largo pre-earnings pack carries.
 *
 * WHY THIS IS A SEPARATE PURE MODULE. The defect it guards was a projection that DROPPED fields:
 * `loadMeridianEarningsPrintHistory` computes a timing-aware reaction for every print — the move,
 * the next-day move, and the `reaction_basis` saying which session it was measured on — and the
 * pack's inline `.map()` kept only the EPS columns. So the Largo path received prints with no move
 * on them at all, while `history_summary` in the same payload still asserted an "avg session move
 * of +3.5%" derived from exactly those discarded numbers: a claim the model could neither verify
 * nor attribute to a row.
 *
 * Dropping `reaction_basis` was the worse half. The basis is not decoration — it is the difference
 * between a REACTION and a PRE-PRINT DRIFT. For an AMC reporter, the report date's own session is
 * the drift BEFORE the numbers were public; measured on one real print the two readings were 7.41%
 * and 3.01%. The Meridian UI marks an assumed anchoring with a "~" (`meridian-viz.tsx`); the model
 * had no equivalent, so an assumption and a measurement arrived as the same undifferentiated
 * number. Carrying the basis is what makes them distinguishable again.
 *
 * `pre-earnings-pack.ts` is `server-only` and reaches its data through dynamic `@/` imports, so
 * neither it nor the mapping could be exercised from a test while the mapping lived inside it.
 * That is precisely how a silent field-drop survives — so the projection lives here instead.
 */

/** The subset of `MeridianEarningsPrint` this projection reads. */
export type PrintHistoryInput = {
  report_date: string | null;
  surprise_pct?: number | null;
  beat?: boolean | null;
  expected_move_pct?: number | null;
  session_change_pct?: number | null;
  next_day_change_pct?: number | null;
  reaction_basis?: "bmo_session" | "amc_next_session" | "assumed_report_session" | null;
};

export type PreEarningsHistoryRow = {
  report_date: string | null;
  surprise_pct: number | null;
  beat: boolean | null;
  expected_move_pct: number | null;
  /** How the stock actually traded the print, open→close on the ANCHORING session. */
  session_change_pct: number | null;
  next_day_change_pct: number | null;
  /**
   * Which session `session_change_pct` was measured on:
   *   bmo_session            — pre-open print; the report date's own session IS the reaction
   *   amc_next_session       — post-close print; the reaction is the FOLLOWING session
   *   assumed_report_session — timing unknown, report date assumed. For an AMC reporter this is
   *                            pre-print drift, so it must read as assumed, never as measured.
   * Null when no move could be measured at all.
   */
  reaction_basis: "bmo_session" | "amc_next_session" | "assumed_report_session" | null;
  /**
   * True when `session_change_pct` rests on an ASSUMPTION about report timing rather than a known
   * BMO/AMC stamp. Derived rather than left implicit: the model should not have to know that one
   * particular enum value out of three carries a caveat. Mirrors the "~" the Meridian UI paints.
   */
  reaction_assumed: boolean;
};

/**
 * Project prints to pack rows, newest-first order preserved, capped at `limit`.
 *
 * Every field is carried explicitly and normalized to `null` rather than `undefined` — an absent
 * key and a null one read the same to a model, but only one of them survives JSON serialization.
 */
export function toPreEarningsHistoryRows(
  prints: readonly PrintHistoryInput[] | null | undefined,
  limit = 6
): PreEarningsHistoryRow[] {
  if (!prints?.length) return [];
  return prints.slice(0, Math.max(0, limit)).map((p) => ({
    report_date: p.report_date ?? null,
    surprise_pct: p.surprise_pct ?? null,
    beat: p.beat ?? null,
    expected_move_pct: p.expected_move_pct ?? null,
    session_change_pct: p.session_change_pct ?? null,
    next_day_change_pct: p.next_day_change_pct ?? null,
    reaction_basis: p.reaction_basis ?? null,
    // Only an actual measurement can be "assumed" — a null basis beside a null move means nothing
    // was measured at all, and flagging THAT as assumed would invent a caveat about a value that
    // does not exist.
    reaction_assumed:
      p.reaction_basis === "assumed_report_session" && p.session_change_pct != null,
  }));
}
