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
import { weekdayEt } from "@/lib/largo/temporal/session-calendar";

export type PrintHistoryInput = {
  report_date: string | null;
  surprise_pct?: number | null;
  beat?: boolean | null;
  expected_move_pct?: number | null;
  session_change_pct?: number | null;
  next_day_change_pct?: number | null;
  reaction_basis?: "bmo_session" | "amc_next_session" | "assumed_report_session" | null;
  reaction_pct?: number | null;
  reaction_measure?: "session_open_to_close" | "prior_close_to_close" | null;
};

export type PreEarningsHistoryRow = {
  report_date: string | null;
  surprise_pct: number | null;
  beat: boolean | null;
  expected_move_pct: number | null;
  /**
   * THE reaction to the print, and the read that produced it. For a post-close print the market
   * prices the news overnight, so this runs from the last close BEFORE the print to the anchoring
   * session's close; `session_change_pct` below cannot contain that gap and is not a substitute.
   */
  reaction_pct: number | null;
  reaction_measure: "session_open_to_close" | "prior_close_to_close" | null;
  /**
   * The ANCHORING session's own open→close. Equal to `reaction_pct` for a pre-open print. For a
   * post-close print it is the intraday drift AFTER the gap — a real quantity, but not the
   * reaction, and it carried the opposite sign on 65 of 206 measured post-close prints.
   */
  session_change_pct: number | null;
  next_day_change_pct: number | null;
  /**
   * Which session the reaction was measured on:
   *   bmo_session            — pre-open print; the report date's own session IS the reaction
   *   amc_next_session       — post-close print; the reaction is the FOLLOWING session
   *   assumed_report_session — timing unknown, report date assumed. For an AMC reporter this is
   *                            pre-print drift, so it must read as assumed, never as measured.
   * Null when no move could be measured at all.
   */
  reaction_basis: "bmo_session" | "amc_next_session" | "assumed_report_session" | null;
  /**
   * The report date's ET weekday. BMO/AMC reasoning IS weekday reasoning — the session that
   * trades an after-close Friday print is Monday, not Saturday — and a model got a weekday wrong
   * in production on this surface. Carrying it removes the inference entirely.
   * Null when the row has no report date to name a weekday for.
   */
  report_weekday: string | null;
  /**
   * True when `reaction_pct` rests on an ASSUMPTION about report timing rather than a known
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
    reaction_pct: p.reaction_pct ?? null,
    reaction_measure: p.reaction_measure ?? null,
    session_change_pct: p.session_change_pct ?? null,
    next_day_change_pct: p.next_day_change_pct ?? null,
    reaction_basis: p.reaction_basis ?? null,
    report_weekday: p.report_date ? weekdayEt(p.report_date) : null,
    // Only an actual measurement can be "assumed" — a null basis beside a null move means nothing
    // was measured at all, and flagging THAT as assumed would invent a caveat about a value that
    // does not exist.
    reaction_assumed:
      p.reaction_basis === "assumed_report_session" &&
      (p.reaction_pct ?? p.session_change_pct) != null,
  }));
}
