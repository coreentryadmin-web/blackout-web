// Pure JS mirror of src/lib/zerodte/earnings-print-window.ts's assessPrintWindow, so the
// counterfactual harness (g11-print-window-outcome.mjs) can classify historical Benzinga
// structured-earnings rows without importing a TS path-aliased module into a plain .mjs script
// (the convention every other scripts/audit/lib/*.mjs helper here follows).
//
// Keep in lockstep with earnings-print-window.ts — this is a copy, not a re-export, so a change to
// the real classifier's semantics must be mirrored here or the counterfactual measures a stale
// gate. earnings-print-window.test.ts is the source of truth if the two ever disagree.

const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

export function etMinutesFromTime(time) {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** input: {date, time, dateStatus}. Returns {verdict, threatensToday, reason, minutesUntil}. */
export function assessPrintWindow(input, todayYmd, nowMin) {
  const date = (input.date ?? "").slice(0, 10);
  const printMin = etMinutesFromTime(input.time);
  const confirmed = (input.dateStatus ?? "").trim().toLowerCase() === "confirmed";

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== todayYmd) {
    return {
      verdict: "after_close",
      threatensToday: false,
      reason: `Prints ${date}, not today — no same-day gap risk.`,
      minutesUntil: null,
    };
  }

  if (printMin == null) {
    return {
      verdict: "unknown",
      threatensToday: true,
      reason: "Print time not stamped — fails closed.",
      minutesUntil: null,
    };
  }

  if (!confirmed) {
    return {
      verdict: "unknown",
      threatensToday: true,
      reason: "Date is projected, not confirmed — fails closed.",
      minutesUntil: printMin - nowMin,
    };
  }

  if (printMin >= RTH_CLOSE_MIN) {
    return {
      verdict: "after_close",
      threatensToday: false,
      reason: `Confirmed print at ${input.time} ET is after the 16:00 close.`,
      minutesUntil: printMin - nowMin,
    };
  }

  if (printMin <= RTH_OPEN_MIN) {
    const landed = nowMin >= printMin;
    return landed
      ? {
          verdict: "pre_open_landed",
          threatensToday: false,
          reason: `Confirmed print at ${input.time} ET already landed before the open.`,
          minutesUntil: printMin - nowMin,
        }
      : {
          verdict: "pre_open_pending",
          threatensToday: true,
          reason: `Confirmed print at ${input.time} ET has NOT landed yet.`,
          minutesUntil: printMin - nowMin,
        };
  }

  return {
    verdict: "intraday",
    threatensToday: true,
    reason: `Confirmed print at ${input.time} ET lands INSIDE the cash session.`,
    minutesUntil: printMin - nowMin,
  };
}
