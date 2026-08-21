/** ET YYYY-MM-DD from a Polygon daily bar open timestamp (ms). */
export function ymdFromBarMs(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export type DailyBarLike = { t?: number; o: number; h: number; l: number; c: number };

export type SessionReaction = {
  session_change_pct: number | null;
  next_day_change_pct: number | null;
};

/** Index bars by ET session date for reaction lookups. */
export function indexBarsByYmd(bars: DailyBarLike[]): Map<string, DailyBarLike> {
  const map = new Map<string, DailyBarLike>();
  for (const bar of bars) {
    const ymd = ymdFromBarMs(bar.t);
    if (ymd) map.set(ymd, bar);
  }
  return map;
}

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return Number((((to - from) / Math.abs(from)) * 100).toFixed(2));
}

/** Session (open→close) and next-calendar-bar (close→close) reaction for one ET date. */
export function reactionForYmd(
  byYmd: Map<string, DailyBarLike>,
  orderedYmds: string[],
  targetYmd: string
): SessionReaction {
  const bar = byYmd.get(targetYmd);
  if (!bar || !Number.isFinite(bar.o) || bar.o === 0) {
    return { session_change_pct: null, next_day_change_pct: null };
  }
  const session_change_pct = pctChange(bar.o, bar.c);
  const idx = orderedYmds.indexOf(targetYmd);
  const nextYmd = idx >= 0 ? orderedYmds[idx + 1] : undefined;
  const nextBar = nextYmd ? byYmd.get(nextYmd) : undefined;
  const next_day_change_pct =
    nextBar && Number.isFinite(bar.c) ? pctChange(bar.c, nextBar.c) : null;
  return { session_change_pct, next_day_change_pct };
}

/** Batch reactions for many dates from one bar series. */
export function reactionsForDates(
  bars: DailyBarLike[],
  dates: string[]
): Map<string, SessionReaction> {
  const byYmd = indexBarsByYmd(bars);
  const orderedYmds = [...byYmd.keys()].sort();
  const out = new Map<string, SessionReaction>();
  for (const d of dates) {
    out.set(d, reactionForYmd(byYmd, orderedYmds, d));
  }
  return out;
}

// ── Earnings print timing ────────────────────────────────────────────────────────────
// WHICH SESSION reflects an earnings print depends on WHEN the company reported, and getting
// this wrong silently inverts the meaning of the number rather than merely degrading it:
//
//   BMO (before market open) — the print lands before the bell, so the report date's own
//     session IS the reaction. Correct as-is.
//   AMC (after market close) — the print lands AFTER that session closed. The report date's
//     open→close is the drift BEFORE anyone saw the numbers; the reaction is the NEXT
//     trading session. Attributing the prior session to the print is not a rounding error —
//     on a stock that drifted up into an ugly print it reports a gain where the market
//     delivered a loss. And picking the right session is only half of it: that session must
//     then be read from the PRIOR CLOSE, not its own open, or the overnight gap — the part
//     that is the reaction — is dropped. See `ReactionMeasure` for the measured cost.
//
// A chart of "how this company reacts to earnings" built on the wrong session is worse than
// no chart, because it looks authoritative. `reaction_basis` travels with every value so the
// UI can mark the ones where timing was unknown and the report session had to be assumed.

export type PrintTiming = "bmo" | "amc" | "unknown";
export type ReactionBasis = "bmo_session" | "amc_next_session" | "assumed_report_session";

/**
 * HOW the reaction was measured — not merely which session it was measured on.
 *
 * Anchoring to the right session is only half of the AMC problem. `session_change_pct` is a
 * session's OPEN→CLOSE, so on the session after a post-close print it measures everything
 * EXCEPT the overnight repricing — and the overnight repricing IS the reaction. Measured over
 * 206 settled post-close prints across 30 large caps (2023-12 → 2026-08):
 *
 *   mean |overnight gap|, excluded by an open→close read : 7.41%
 *   mean |open→close| on that same session               : 3.05%
 *   mean |close→close|, what the print actually did      : 8.11%
 *   prints where open→close carries the OPPOSITE SIGN    : 65/206 = 31.6%
 *
 * e.g. MSFT 2025-04-30 (AMC): gapped +9.07%, then drifted -1.32% through the session. An
 * open→close read reports the stock FELL on the print. It rose 7.63%.
 *
 * So the measure travels with the value, the way `reaction_basis` already carries the session:
 *   session_open_to_close — the anchor session's own open→close (correct for a pre-open print,
 *                           which the market has all session to price).
 *   prior_close_to_close  — the last close BEFORE the print → the anchor session's close. The
 *                           only read that contains the gap, and the correct one for AMC.
 */
export type ReactionMeasure =
  | "session_open_to_close"
  | "prior_close_to_close"
  /**
   * The same two reads, taken while the anchor session is STILL OPEN — so the far end is the last
   * trade, not the close.
   *
   * Measured on prod 2026-08-21 at 09:46 ET, sixteen minutes into a session that closes at 16:00.
   * Today's BMO prints came back as settled measurements:
   *
   *   BEKE  reaction_pct -4.74  reaction_measure "session_open_to_close"  reaction_basis "bmo_session"
   *   BJ    reaction_pct  1.74  reaction_measure "session_open_to_close"
   *   BKE   reaction_pct  2.21  reaction_measure "session_open_to_close"
   *
   * BJ and BKE match Polygon's PARTIAL daily bar for today exactly — a bar whose "close" is
   * simply the last trade so far. BEKE moved from -4.74 to -4.24 between two reads a minute
   * apart, which is the number disproving its own label while you watch.
   *
   * Nothing in the payload marked it: no `provisional`, `partial`, `in_progress`, `settled` or
   * `session_complete` field existed anywhere. So a six-hour-old-at-most, still-moving figure was
   * presented identically to a print from three quarters ago, and `session_open_to_close` asserted
   * a close that had not happened.
   */
  | "session_open_to_last"
  | "prior_close_to_last";

/**
 * Classify a Benzinga earnings `time` (ET, "HH:MM:SS") against the RTH bell.
 * At-or-before 09:30 is pre-open; at-or-after 16:00 is post-close. A timestamp strictly
 * inside the session is genuinely ambiguous (mid-session releases are rare and usually a
 * data artifact), so it reports `unknown` rather than being forced into a bucket.
 */
export function classifyPrintTiming(timeEt: string | null | undefined): PrintTiming {
  if (!timeEt) return "unknown";
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeEt).trim());
  if (!m) return "unknown";
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(mins)) return "unknown";
  if (mins <= 9 * 60 + 30) return "bmo";
  if (mins >= 16 * 60) return "amc";
  return "unknown";
}

/** The next ET session on/after `ymd` present in the bar series (skips weekends/holidays). */
function nextSessionYmd(orderedYmds: string[], afterYmd: string): string | null {
  for (const y of orderedYmds) if (y > afterYmd) return y;
  return null;
}

export type PrintReaction = SessionReaction & {
  reaction_basis: ReactionBasis | null;
  /**
   * False when the anchor session has not closed yet, so `reaction_pct` is still moving.
   * Null when nothing was measured. Derived rather than left for the reader to infer from the
   * measure enum: a consumer filtering for settled history should not have to know which two of
   * four measure values mean "final".
   */
  reaction_settled: boolean | null;
  /**
   * THE reaction to the print, measured the way `reaction_measure` says. Prefer this over
   * `session_change_pct` for anything that calls itself a reaction: the two are the same
   * number for a pre-open print and routinely differ in SIGN for a post-close one.
   */
  reaction_pct: number | null;
  reaction_measure: ReactionMeasure | null;
};

/**
 * Reaction to an earnings print, anchored to the session the market could actually trade the
 * news in. Returns nulls (never a fabricated move) when the anchoring session has no bar.
 */
export function reactionForPrint(
  byYmd: Map<string, DailyBarLike>,
  orderedYmds: string[],
  reportYmd: string,
  timing: PrintTiming,
  /**
   * The ET date of a session that is currently OPEN, or null when the market is closed.
   * Passed in rather than read from a clock so this stays pure and testable — the same reason
   * the bar series is passed in rather than fetched.
   */
  openSessionYmd: string | null = null
): PrintReaction {
  const basis: ReactionBasis =
    timing === "amc" ? "amc_next_session" : timing === "bmo" ? "bmo_session" : "assumed_report_session";
  const anchor = timing === "amc" ? nextSessionYmd(orderedYmds, reportYmd) : reportYmd;
  const nulls: PrintReaction = {
    session_change_pct: null,
    next_day_change_pct: null,
    reaction_basis: null,
    reaction_pct: null,
    reaction_measure: null,
    reaction_settled: null,
  };
  if (!anchor) return nulls;
  const rx = reactionForYmd(byYmd, orderedYmds, anchor);

  // The headline reaction. A post-close print is priced overnight, so it is read from the LAST
  // CLOSE BEFORE THE PRINT (the report date's own close) to the anchor session's close — an
  // open→close read on the anchor session would skip the gap that is the reaction. A pre-open
  // print is read open→close, because the market has that whole session to price it.
  const anchorBar = byYmd.get(anchor);
  const priorClose = timing === "amc" ? byYmd.get(reportYmd)?.c : undefined;
  const reaction_pct =
    timing === "amc"
      ? priorClose != null && anchorBar != null
        ? pctChange(priorClose, anchorBar.c)
        : null
      : rx.session_change_pct;
  // The anchor session being TODAY-and-open is what makes the far end a last trade rather than a
  // close, so the measure says so and `reaction_settled` carries the same fact as a boolean.
  const settled = !(openSessionYmd != null && anchor === openSessionYmd);
  const measure: ReactionMeasure =
    timing === "amc"
      ? settled
        ? "prior_close_to_close"
        : "prior_close_to_last"
      : settled
        ? "session_open_to_close"
        : "session_open_to_last";

  // Basis only means something once a real move was measured — reporting a basis beside two
  // nulls would claim we know how a value we do not have was derived. Same for the measure:
  // it describes `reaction_pct`, so it is only claimed when there is a reaction_pct to describe.
  const measured = rx.session_change_pct != null || rx.next_day_change_pct != null || reaction_pct != null;
  return {
    ...rx,
    reaction_basis: measured ? basis : null,
    reaction_pct,
    reaction_measure: reaction_pct != null ? measure : null,
    reaction_settled: reaction_pct != null ? settled : null,
  };
}

/** Batch print reactions. `timings` maps report date → print timing. */
export function reactionsForPrints(
  bars: DailyBarLike[],
  prints: Array<{ ymd: string; timing: PrintTiming }>,
  openSessionYmd: string | null = null
): Map<string, PrintReaction> {
  const byYmd = indexBarsByYmd(bars);
  const orderedYmds = [...byYmd.keys()].sort();
  const out = new Map<string, PrintReaction>();
  for (const p of prints) {
    out.set(p.ymd, reactionForPrint(byYmd, orderedYmds, p.ymd, p.timing, openSessionYmd));
  }
  return out;
}

/**
 * Trading-day count a [from,to] window needs, plus headroom.
 *
 * The limit MUST be derived from the window, never fixed. This was hardcoded to "120" while
 * `barWindowForDates` spans from 14 days before the OLDEST requested date to today — for
 * earnings print history that is ~4-8 quarters, i.e. 260-500 trading days. Polygon returns
 * `sort=asc`, so a 120 cap silently returns only the OLDEST 120 sessions and every recent
 * date falls outside the response. Measured live 2026-08-17: across HTHT/FN/BIDU the two
 * oldest prints resolved and every print after ~Jan 2026 came back null — including the most
 * recent one, which is the single reaction a trader most wants. The bug reads as "we don't
 * have that data" rather than as a truncated fetch, which is why it survived.
 *
 * ~252 trading days/year → 0.7 × calendar days, +10 sessions of slack for holidays.
 */
export function barLimitForWindow(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms <= 0) return 120;
  const calendarDays = ms / 86_400_000;
  const estimate = Math.ceil(calendarDays * 0.7) + 10;
  // Floor keeps short windows cheap; ceiling stops a malformed date from requesting the world.
  return Math.min(5000, Math.max(120, estimate));
}
