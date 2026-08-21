/**
 * The CURRENT 0DTE session phase, for any Largo tool that would otherwise let the model invent it.
 *
 * ── THE DEFECT THIS CLOSES (measured live 2026-08-21, 05:00 ET) ──────────────────────────────
 *
 * Asked what the scanner rejected today, Largo correctly said the rejection rows were from the
 * PRIOR session — then added, in the present tense, "the market opened at 9:30 AM ET and the scan
 * cycle is still running." It was 05:00 ET. The market was not open. The tool gave the model row
 * timestamps but never told it what time it is NOW or whether the session is live, so the model
 * fabricated the one fact it was missing.
 *
 * A tool that hands over historical rows with no "as of now" anchor invites exactly this. This is
 * the C1 session anchor (ET stamp + ET session date) plus the piece C1 alone does not carry: the
 * session PHASE, so the model can say "it is pre-market, the open is 9:30 ET" instead of guessing.
 */

import { sessionHeat, type SessionHeatState } from "./board";
import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import { etNowParts, todayEt, isTradingDayEt } from "@/features/nighthawk/lib/session";

export type ZerodteSessionAnchor = {
  /** ET wall-clock stamp for NOW — what the model must read as "now", never a bare UTC instant. */
  as_of_et: string | null;
  /** The ET trading session this "now" belongs to. */
  session_date: string | null;
  /** Where in the day we are: PRE_MARKET / OPENING_DRIVE / RTH / POST_COMMIT / LATE_SESSION / CLOSED. */
  session_state: SessionHeatState;
  /** A one-line, present-tense truth the model can state verbatim instead of inventing one. */
  session_note: string;
};

const OPEN_LABEL = "9:30 ET";

function noteFor(state: SessionHeatState): string {
  switch (state) {
    case "PRE_MARKET":
      return `The market is NOT open yet — it is pre-market. Regular trading opens at ${OPEN_LABEL}. ` +
        `Any 0DTE scan rows below are from a PRIOR session; the scanner has not run for today yet.`;
    case "OPENING_DRIVE":
      return "The market just opened — the opening drive is in progress; the 0DTE scanner is live.";
    case "RTH":
      return "The market is open (regular trading hours); the 0DTE scanner is live.";
    case "POST_COMMIT":
      return "The market is open but past the 15:30 ET new-play cutoff — no fresh commits, open plays are managed to exit.";
    case "LATE_SESSION":
      return "The market is open but in the 15:50–16:00 ET flat-by-time-stop window — no fresh entries.";
    case "CLOSED":
    default:
      return "The market is closed. Any 0DTE scan rows below are from the most recent session, not a live one.";
  }
}

/** Compose the current session anchor from the shared clock helpers. Reads the clock; no IO. */
export function currentZerodteSessionAnchor(nowMs: number = Date.now()): ZerodteSessionAnchor {
  const ymd = todayEt();
  const tradingDay = isTradingDayEt(ymd);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);
  return {
    as_of_et: etStamp(nowMs),
    session_date: etSessionDate(nowMs),
    session_state: heat.state,
    session_note: noteFor(heat.state),
  };
}
