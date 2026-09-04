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
  reaction_measure?:
    | "session_open_to_close"
    | "prior_close_to_close"
    | "session_open_to_last"
    | "prior_close_to_last"
    | null;
  reaction_settled?: boolean | null;
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
  /**
   * How `reaction_pct` was measured. A `_to_last` value means the anchor session was STILL OPEN
   * when this was read — the far end is the last trade, not a close, and the number is still
   * moving. Measured live on 2026-08-21 at 09:46 ET, today's BMO prints came back labelled
   * `session_open_to_close` sixteen minutes into a session closing at 16:00, matching Polygon's
   * partial daily bar exactly; one of them moved half a point between two reads a minute apart.
   */
  reaction_measure:
    | "session_open_to_close"
    | "prior_close_to_close"
    | "session_open_to_last"
    | "prior_close_to_last"
    | null;
  /**
   * False while the anchor session is open. Carried as a BOOLEAN as well as in the measure so a
   * model does not have to know which two of four enum values mean "final" before deciding
   * whether a number is safe to compare against settled history.
   */
  reaction_settled: boolean | null;
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
    reaction_settled: p.reaction_settled ?? null,
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

/**
 * Has the print `pre-earnings-pack.ts` is building a pack for ALREADY happened?
 *
 * `preEarningsPackForLargo`'s `expected_move_pct` is sourced from the LIVE options chain — current
 * ATM IV, with no anchor to "before this specific print" (`loadEarningsExpectedMove`'s own doc
 * comment: "ATM IV from the live Polygon chain"). For a genuinely upcoming print that is exactly
 * the right number. For a print that already happened, the SAME code path instead measures
 * POST-print IV — the market's forward-looking vol for whatever expiry is nearest NOW — while the
 * pack still frames it as `kind: "pre_earnings"` beside an "Options-implied move" chip
 * (`LargoPreEarningsPackCard.tsx`) that reads as "the market expects this print to move ~X%."
 * Measured live 2026-09-04: LULU, printed hours earlier the same session on a steep guidance cut
 * (a real intraday crash), served `expected_move_pct: 50.3` under this exact pack — a number
 * describing CURRENT elevated post-crash IV, presented as though it were the market's PRE-print
 * expectation. The same stale figure also flows into `meridian-earnings-intel.ts`'s
 * `input.pack.expected_move_pct` fallback and its derived up/down expected-move price band.
 *
 * Same root defect class as the cross-event `expected_vs_realized` fix (FINDINGS.md, 2026-08-21:
 * "a number a consumer must not pair does not belong in the block") — just at a call site that fix
 * never reached, since it patched the comparison banner, not this pack's own field.
 *
 * DETECTION: `print_history` only ever contains rows Benzinga confirms with real ACTUAL EPS or
 * revenue (`benzingaRowsToPrintHistory`'s `actual_eps != null || actual_revenue != null` filter —
 * this module's own header explains why the projection lives in this separate, TESTABLE file
 * rather than inline in `pre-earnings-pack.ts`, which is `server-only` and reaches its data through
 * dynamic `@/` imports this module deliberately never adds). A print-history row dated exactly
 * `resolvedDate` is proof — not a guess — that THIS print already has real numbers on file.
 */
export function earningsAlreadyPrinted(
  resolvedDate: string | null,
  printHistory: readonly { report_date: string | null }[]
): boolean {
  return resolvedDate != null && printHistory.some((p) => p.report_date === resolvedDate);
}
