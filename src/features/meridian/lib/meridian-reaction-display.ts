import type { MeridianEarningsPrint } from "./meridian-types";

/**
 * The qualifiers a displayed reaction must carry, derived from the fields the engine already
 * computes for exactly this purpose.
 *
 * `meridian-reaction-core.ts` computes `reaction_basis`, `reaction_measure` and
 * `reaction_settled` precisely so a reader can tell a measurement from an assumption and a
 * final number from one still forming. All three reached the component props and **no component
 * read any of them** — every render site printed the bare percentage, so:
 *
 *   - a print whose timing Benzinga never resolved (`assumed_report_session`) rendered
 *     identically to one anchored to a known BMO/AMC bell. Measured live 2026-08-22 over 11,956
 *     settled prints, 219 (1.8%; 0.5% at `importance>=3`) carry a mid-session timestamp and land
 *     in this bucket — and over the 25 such `importance>=3` prints, reading them as AMC instead
 *     flips the sign on 12 (48%) and moves the value by a median 2.82pp. Small, and the member
 *     could not tell which 1.8% they were looking at.
 *
 *   - a reaction still being formed rendered as settled history. `reaction_settled` exists
 *     because production served a moving number at 09:46 ET on a session closing at 16:00 —
 *     BEKE went from -4.74 to -4.24 between two reads a minute apart. During RTH this is not a
 *     rare slice: it is EVERY print reporting that morning.
 *
 * Kept pure and separate from the components so the rule is stated once and tested directly,
 * rather than re-derived at each of the three render sites that got it wrong by omission.
 */
export type ReactionQualifier = {
  /** Terse marker to sit beside the number. */
  mark: string;
  /** Drives badge color: yellow = still forming, red = assumed anchoring. */
  kind: "live" | "assumed";
  /** The full sentence, for a `title`/tooltip — the mark alone cannot carry this. */
  title: string;
  /** True when the value is NOT a settled measurement of a known-timing print. */
  provisional: boolean;
};

type ReactionFields = Pick<
  MeridianEarningsPrint,
  "reaction_basis" | "reaction_settled" | "reaction_pct" | "session_change_pct"
>;

/**
 * Null when the number is a plain settled measurement and needs no qualifier — the common case,
 * so the UI stays quiet rather than badging every row.
 *
 * Unsettled outranks assumed when both apply: "this is still moving" is the more urgent fact,
 * and a value that has not finished forming cannot be judged on its anchoring yet.
 */
export function reactionQualifier(print: ReactionFields): ReactionQualifier | null {
  // Nothing measured → nothing to qualify. The row renders no reaction at all in that case.
  if ((print.reaction_pct ?? print.session_change_pct) == null) return null;

  if (print.reaction_settled === false) {
    return {
      mark: "live",
      kind: "live",
      title:
        "Still moving — the session this print is measured on has not closed yet, so this is the last trade, not a final reaction.",
      provisional: true,
    };
  }

  if (print.reaction_basis === "assumed_report_session") {
    return {
      mark: "assumed",
      kind: "assumed",
      title:
        "Report timing unknown — this is measured on the report date's own session, which is an assumption, not a measurement. If the company in fact reported after the close, the reaction was the NEXT session and this number can carry the opposite sign.",
      provisional: true,
    };
  }

  // `reaction_pct` itself was never computed — for a BMO/AMC print the gap-inclusive reaction
  // needs the bar BEFORE the print (the report date's own close for AMC, the prior session's
  // close for BMO) as its anchor, and that bar can be missing even when the anchor session's own
  // bar resolved fine (a fetch-window edge, a data gap, a print right at the start of the
  // retained window). `reactionForPrint` (meridian-reaction-core.ts) still stamps
  // `reaction_basis`/`session_change_pct` in that case — it measured THE ANCHOR SESSION, just
  // not the gap — so this cannot be caught by the two checks above. Every render site falls back
  // to `session_change_pct` via `reaction_pct ?? session_change_pct`, which would silently
  // substitute the anchor session's bare open-to-close for the reaction — for a BMO/AMC print
  // the overnight gap IS the reaction, and dropping it is exactly the defect
  // `loadMeridianEarningsPrintHistory`'s own header warns about ("reaction_pct, not
  // session_change_pct: ... Averaging it produced a headline... that disagreed in sign with the
  // market on ~a third of post-close prints"), reached here through a missing bar instead of a
  // stale field. Reproduced directly off the real `reactionForPrint`: an AMC print whose report
  // date has no bar in the fetched window, but whose next session does, returns
  // `{ reaction_pct: null, session_change_pct: 1, reaction_basis: "amc_next_session",
  // reaction_settled: null }` — every field this function already checks says "measured", and
  // the value about to render is not the reaction at all.
  if (print.reaction_pct == null) {
    return {
      mark: "~",
      kind: "assumed",
      title:
        "The reaction across the report's own gap could not be measured — the number shown is this session's plain open-to-close, not the report's reaction, and may be missing part or all of the real move.",
      provisional: true,
    };
  }

  return null;
}

/**
 * The subset of prints whose reactions may be pooled into a distribution — implied-vs-realized,
 * an average, a beat/miss rail.
 *
 * A provisional value is not a realized outcome, and an assumed one may be measuring the wrong
 * session entirely. Averaging either into "what this company usually does on earnings" launders
 * an unknown into a statistic, which is the failure `_COMMON.md` §7 names: an unmeasured tape
 * must not arrive as a measured number. The caller is expected to report the excluded count
 * rather than silently serving a shorter list.
 */
export function settledReactions<T extends ReactionFields>(prints: readonly T[]): T[] {
  return prints.filter((p) => reactionQualifier(p) == null);
}
