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
