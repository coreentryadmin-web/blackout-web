/**
 * 0DTE earnings PRINT-WINDOW classifier — does a name's print actually threaten TODAY's 0DTE?
 *
 * ── WHY THIS EXISTS, AND WHY IT DOES NOT (YET) CHANGE ANY GATE ─────────────────────────────────
 *
 * G-11 blocks a fresh 0DTE commit when the ticker is an earnings reporter today or next-day. That
 * is the right default with a COARSE feed: the old snapshot carries only `report_date` and a
 * premarket/afterhours bucket inferred from the date, so "reports today" is the most the gate can
 * honestly say.
 *
 * The Benzinga structured feed carries the exact ET print time and a confirmed/projected status,
 * which makes a sharper statement possible — and the sharpest version is not "block less", it is
 * "block the right ones". Three cases the coarse gate currently treats identically:
 *
 *   1. AFTER-CLOSE print (16:00+). A 0DTE expires at the close. The position is FLAT before the
 *      print happens, so the print cannot gap it. Blocking here forgoes a whole session of trades
 *      on the biggest, most liquid names in the market for a risk that does not exist that day.
 *   2. PRE-OPEN print that ALREADY LANDED this morning. The gap risk resolved before the session
 *      began; what remains is elevated realized vol, which is a sizing question, not a block.
 *   3. INTRADAY print. Genuinely dangerous and currently blocked — correctly.
 *
 * THIS MODULE ONLY CLASSIFIES. It deliberately does not call, modify, or wire into gates.ts. A
 * change to a live risk gate is a change to what gets traded with real money, and the repo's
 * pattern for that (see the iron-condor calibration table) is evidence first, gating second. The
 * classifier exists so the counterfactual can be MEASURED — how many commits would each case have
 * unlocked, and how would they have graded — before anything is unblocked.
 *
 * The fail-closed posture is preserved at every ambiguity: unknown time, unknown date status, or a
 * missing row all classify as THREATENING. A print we cannot time is exactly the one not to trade
 * through, and this module must never be the reason a gate opens on incomplete data.
 */

/** ET minutes-from-midnight for the cash session. 0DTE positions are flat at the close. */
const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

export type PrintWindowVerdict =
  /** Print lands after this session's close — a 0DTE is already flat. No same-day gap risk. */
  | "after_close"
  /** Print already landed before the open today — gap risk resolved; elevated vol remains. */
  | "pre_open_landed"
  /** Print lands before the open but has NOT happened yet (an early read, pre-market). */
  | "pre_open_pending"
  /** Print lands inside the cash session — the dangerous case. */
  | "intraday"
  /** Not enough information to time the print. Treated as threatening. */
  | "unknown";

export type PrintWindowInput = {
  /** ET print date, YYYY-MM-DD. */
  date: string | null | undefined;
  /** ET wall-clock print time, HH:MM[:SS]. */
  time: string | null | undefined;
  /** Benzinga date_status — only "confirmed" is treated as a timed fact. */
  dateStatus: string | null | undefined;
};

export type PrintWindowAssessment = {
  verdict: PrintWindowVerdict;
  /** True when this print can still move the underlying while a 0DTE is open TODAY. */
  threatensToday: boolean;
  /** Why — surfaced verbatim in gate/audit output so a decision is never unexplained. */
  reason: string;
  /** Minutes from `nowMin` until the print. Negative = already landed. Null when untimed. */
  minutesUntil: number | null;
};

/** Parse "HH:MM[:SS]" to ET minutes-from-midnight. Null on anything unparseable. */
export function etMinutesFromTime(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Classify a print against TODAY's 0DTE session.
 *
 * `todayYmd` and `nowMin` (ET minutes-from-midnight) are parameters, not clock reads, so this is
 * pure and testable — the same reason the print clock takes `nowMs` from its caller.
 */
export function assessPrintWindow(
  input: PrintWindowInput,
  todayYmd: string,
  nowMin: number
): PrintWindowAssessment {
  const date = (input.date ?? "").slice(0, 10);
  const printMin = etMinutesFromTime(input.time);
  const confirmed = (input.dateStatus ?? "").trim().toLowerCase() === "confirmed";

  // A print on another day cannot threaten today's 0DTE. This is the ONE case that is safe without
  // a time, because the date alone settles it.
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== todayYmd) {
    return {
      verdict: "after_close",
      threatensToday: false,
      reason: `Prints ${date}, not today — no same-day gap risk to a 0DTE that expires at today's close.`,
      minutesUntil: null,
    };
  }

  // Everything below concerns a print dated TODAY (or a row whose date we could not read, which
  // must not be assumed to be another day).
  if (printMin == null) {
    return {
      verdict: "unknown",
      threatensToday: true,
      reason:
        "Print time not stamped — a print that cannot be timed is treated as threatening " +
        "(fail-closed: an untimed print is exactly the one not to trade through).",
      minutesUntil: null,
    };
  }

  // A PROJECTED date is Benzinga's guess, not the company's statement. Its time carries the same
  // uncertainty, so it does not earn the after-close exemption — the whole exemption rests on
  // knowing the print lands after the position is flat.
  if (!confirmed) {
    return {
      verdict: "unknown",
      threatensToday: true,
      reason:
        "Date is projected, not company-confirmed — the print time is not a reliable enough fact " +
        "to exempt a commit, so this fails closed.",
      minutesUntil: printMin - nowMin,
    };
  }

  if (printMin >= RTH_CLOSE_MIN) {
    return {
      verdict: "after_close",
      threatensToday: false,
      reason:
        `Confirmed print at ${input.time} ET is after the 16:00 close — a 0DTE is already flat, ` +
        "so the print cannot gap the position.",
      minutesUntil: printMin - nowMin,
    };
  }

  if (printMin <= RTH_OPEN_MIN) {
    const landed = nowMin >= printMin;
    return landed
      ? {
          verdict: "pre_open_landed",
          threatensToday: false,
          reason:
            `Confirmed print at ${input.time} ET already landed before the open — the gap risk ` +
            "resolved pre-session; what remains is elevated realized vol, which is a sizing " +
            "question rather than a commit block.",
          minutesUntil: printMin - nowMin,
        }
      : {
          verdict: "pre_open_pending",
          threatensToday: true,
          reason:
            `Confirmed print at ${input.time} ET has NOT landed yet — the gap is still ahead.`,
          minutesUntil: printMin - nowMin,
        };
  }

  return {
    verdict: "intraday",
    threatensToday: true,
    reason:
      `Confirmed print at ${input.time} ET lands INSIDE the cash session — the dangerous case: ` +
      "an open 0DTE can be repriced mid-position.",
    minutesUntil: printMin - nowMin,
  };
}

export type PrintWindowTally = Record<PrintWindowVerdict, number> & {
  /** Rows the COARSE gate blocks that a window-aware gate would not. The measurable prize. */
  exemptible: number;
  total: number;
};

/**
 * Tally verdicts across a set of reporters — the counterfactual input.
 *
 * `exemptible` is the number this module claims the coarse gate over-blocks. It is reported as a
 * COUNT, not acted on: turning it into an unblock needs the graded outcome of those specific
 * would-be commits, which is a separate measurement against real minute bars.
 */
export function tallyPrintWindows(
  rows: readonly PrintWindowInput[],
  todayYmd: string,
  nowMin: number
): PrintWindowTally {
  const tally: PrintWindowTally = {
    after_close: 0,
    pre_open_landed: 0,
    pre_open_pending: 0,
    intraday: 0,
    unknown: 0,
    exemptible: 0,
    total: 0,
  };
  for (const row of rows) {
    const a = assessPrintWindow(row, todayYmd, nowMin);
    tally[a.verdict]++;
    tally.total++;
    if (!a.threatensToday) tally.exemptible++;
  }
  return tally;
}
