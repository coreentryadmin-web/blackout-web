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
//     delivered a loss.
//
// A chart of "how this company reacts to earnings" built on the wrong session is worse than
// no chart, because it looks authoritative. `reaction_basis` travels with every value so the
// UI can mark the ones where timing was unknown and the report session had to be assumed.

export type PrintTiming = "bmo" | "amc" | "unknown";
export type ReactionBasis = "bmo_session" | "amc_next_session" | "assumed_report_session";

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

export type PrintReaction = SessionReaction & { reaction_basis: ReactionBasis | null };

/**
 * Reaction to an earnings print, anchored to the session the market could actually trade the
 * news in. Returns nulls (never a fabricated move) when the anchoring session has no bar.
 */
export function reactionForPrint(
  byYmd: Map<string, DailyBarLike>,
  orderedYmds: string[],
  reportYmd: string,
  timing: PrintTiming
): PrintReaction {
  const basis: ReactionBasis =
    timing === "amc" ? "amc_next_session" : timing === "bmo" ? "bmo_session" : "assumed_report_session";
  const anchor = timing === "amc" ? nextSessionYmd(orderedYmds, reportYmd) : reportYmd;
  if (!anchor) return { session_change_pct: null, next_day_change_pct: null, reaction_basis: null };
  const rx = reactionForYmd(byYmd, orderedYmds, anchor);
  // Basis only means something once a real move was measured — reporting a basis beside two
  // nulls would claim we know how a value we do not have was derived.
  const measured = rx.session_change_pct != null || rx.next_day_change_pct != null;
  return { ...rx, reaction_basis: measured ? basis : null };
}

/** Batch print reactions. `timings` maps report date → print timing. */
export function reactionsForPrints(
  bars: DailyBarLike[],
  prints: Array<{ ymd: string; timing: PrintTiming }>
): Map<string, PrintReaction> {
  const byYmd = indexBarsByYmd(bars);
  const orderedYmds = [...byYmd.keys()].sort();
  const out = new Map<string, PrintReaction>();
  for (const p of prints) {
    out.set(p.ymd, reactionForPrint(byYmd, orderedYmds, p.ymd, p.timing));
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
