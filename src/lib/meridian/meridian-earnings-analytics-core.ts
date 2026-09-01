/**
 * Meridian earnings ANALYTICS core — pure, testable transforms over Benzinga structured earnings.
 *
 * WHY A -core FILE. Everything here is a pure function of rows the provider already fetched, so it
 * runs under `tsx --test` with no network, no Redis and no React. The panels that render it are
 * canvas/DOM and cannot be unit-tested; the maths can, and the maths is what can be silently wrong.
 *
 * THE STANDING RULE IN THIS FILE: never manufacture a number the data does not contain. A print
 * that has not happened has `actual_eps == null`, and every derived field for it must be `null`, not
 * `0`. Zero is a MEANINGFUL surprise value (an exact in-line print), so collapsing "unknown" into
 * "exactly in line" would invent a fact — the same `Number(null) === 0` trap that has produced two
 * real defects in this repo already. Callers render `null` as an em-dash, never as a number.
 */

/**
 * The MINIMUM shape these transforms read — deliberately structural, not the provider type.
 *
 * `EarningsAnalyticsRow` satisfies this, and so does the server payload row the desk carries,
 * so the same tested maths runs on both without an adapter and without the analytics layer taking a
 * hard dependency on one provider's field set. If a second earnings source ever lands, it conforms
 * to this instead of the core being rewritten.
 */
export type EarningsAnalyticsRow = {
  ticker: string;
  company_name: string | null;
  date: string;
  time: string | null;
  date_status: string | null;
  importance: number | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  estimated_eps: number | null;
  actual_eps: number | null;
  estimated_revenue: number | null;
  actual_revenue: number | null;
  eps_surprise_pct: number | null;
  revenue_surprise_pct: number | null;
};

/** ET session bucket a print lands in — the thing that decides whether it is tradeable today. */
export type PrintSession = "pre" | "post" | "intraday" | "unknown";

/**
 * Classify the print time into an ET session.
 *
 * Benzinga `time` is an ET wall-clock string ("05:00:00", "16:30:00"). Anything at/before the 09:30
 * open is a pre-market print, anything at/after the 16:00 close is post-market, and the remainder
 * genuinely lands mid-session. A missing or malformed time is "unknown" and NOT silently bucketed —
 * a name whose print time we do not know is exactly the one a member must not assume about.
 */
export function classifyPrintSession(time: string | null | undefined): PrintSession {
  if (!time) return "unknown";
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return "unknown";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return "unknown";
  const mins = h * 60 + min;
  if (mins <= 9 * 60 + 30) return "pre";
  if (mins >= 16 * 60) return "post";
  return "intraday";
}

/** Has this row actually printed? The single predicate every "is it real yet" branch must use. */
export function hasPrinted(row: EarningsAnalyticsRow): boolean {
  return row.actual_eps != null && Number.isFinite(row.actual_eps);
}

/** The minimum shape `printHistoryToAnalyticsRows` needs from a per-ticker print row — deliberately
 *  structural (not `MeridianEarningsPrint` itself) so this file has no import on `meridian-types`. */
export type PrintHistoryRowLike = {
  report_date: string | null;
  eps_estimate: number | null;
  eps_actual: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  revenue_surprise_pct?: number | null;
  surprise_pct: number | null;
};

/**
 * Adapts a per-ticker `print_history` array (the real historical print record — what
 * `MeridianBeatHistory`/`MeridianEarningsHistoryPanel`'s Beat Rates card already reads) into
 * `EarningsAnalyticsRow` shape, so `buildBeatMissStreak` can read the SAME data instead of the
 * market-wide forward Benzinga calendar window it was wired to before.
 *
 * That prior wiring is why the Quarterly Beat/Miss Streak card could say "No printed quarters on
 * record" two panels below "7/8 EPS beats" for the same ticker: `earnings_analytics_rows` is a
 * days-ahead WHO'S-REPORTING-WHEN calendar, not a history of past prints, so `hasPrinted` almost
 * never found a match there. `print_history` is the real thing; this just reshapes it.
 *
 * Rows with no `report_date` are dropped — `EarningsAnalyticsRow.date` is non-nullable and a
 * streak entry needs a real date to sort and display, not a fabricated one.
 */
export function printHistoryToAnalyticsRows(
  ticker: string,
  prints: readonly PrintHistoryRowLike[]
): EarningsAnalyticsRow[] {
  return prints
    .filter((p): p is PrintHistoryRowLike & { report_date: string } => p.report_date != null)
    .map((p) => ({
      ticker,
      company_name: null,
      date: p.report_date,
      time: null,
      date_status: null,
      importance: null,
      fiscal_period: null,
      fiscal_year: null,
      estimated_eps: p.eps_estimate,
      actual_eps: p.eps_actual,
      estimated_revenue: p.revenue_estimate ?? null,
      actual_revenue: p.revenue_actual ?? null,
      // `EarningsAnalyticsRow.eps_surprise_pct`/`revenue_surprise_pct` are a FRACTION (0.0447 =
      // 4.47%) everywhere else in this file -- `fmtSurprisePct` multiplies by 100, and the
      // Beat/Miss Streak bar height multiplies by 200 -- but `print_history`'s `surprise_pct`/
      // `revenue_surprise_pct` are already a DISPLAY PERCENT (`benzingaSurpriseToDisplayPct` in
      // meridian-benzinga-earnings-core.ts multiplies the raw ratio by 100 before storing it
      // there). Copying them straight through used to feed an already-scaled value into a
      // formatter that scales again -- a real -0.7% surprise rendered as "-70.0%" on the History
      // tab's Beat/Miss Streak "avg" stat, every per-entry tooltip, and the streak-bar heights
      // (which all clamped to max height, losing the intended visual scale). Divide back down to
      // the fraction convention this whole file uses.
      eps_surprise_pct: p.surprise_pct == null ? null : p.surprise_pct / 100,
      revenue_surprise_pct: p.revenue_surprise_pct == null ? null : p.revenue_surprise_pct / 100,
    }));
}

export type SurpriseQuadrant =
  | "double_beat"
  | "eps_beat_rev_miss"
  | "eps_miss_rev_beat"
  | "double_miss"
  | "incomplete";

/**
 * Quadrant for the EPS-vs-revenue scatter.
 *
 * "incomplete" is a first-class outcome, not a fallback: a row missing either surprise cannot be
 * placed on a two-axis chart, and guessing its quadrant would put a fabricated dot in front of a
 * member. Those rows are counted and reported separately rather than dropped silently — a scatter
 * that quietly omits a third of the week reads as a complete picture when it is not.
 */
export function surpriseQuadrant(
  epsSurprisePct: number | null | undefined,
  revSurprisePct: number | null | undefined
): SurpriseQuadrant {
  const e = epsSurprisePct;
  const r = revSurprisePct;
  if (e == null || r == null || !Number.isFinite(e) || !Number.isFinite(r)) return "incomplete";
  if (e >= 0 && r >= 0) return "double_beat";
  if (e >= 0 && r < 0) return "eps_beat_rev_miss";
  if (e < 0 && r >= 0) return "eps_miss_rev_beat";
  return "double_miss";
}

export type ScatterPoint = {
  ticker: string;
  company: string | null;
  date: string;
  eps_surprise_pct: number;
  rev_surprise_pct: number;
  importance: number;
  quadrant: SurpriseQuadrant;
};

export type SurpriseScatter = {
  points: ScatterPoint[];
  /** Rows that printed but lack one/both surprise axes — reported, never silently dropped. */
  incomplete: number;
  /** Rows in the window that have not printed yet. */
  pending: number;
  counts: Record<Exclude<SurpriseQuadrant, "incomplete">, number>;
  /** Symmetric axis bound so the origin sits dead centre and beats/misses are visually comparable. */
  bound: number;
};

/** Axis bound: the largest |surprise| on either axis, padded, floored so a flat week still renders. */
function scatterBound(points: ScatterPoint[]): number {
  let max = 0;
  for (const p of points) {
    max = Math.max(max, Math.abs(p.eps_surprise_pct), Math.abs(p.rev_surprise_pct));
  }
  // A 5% floor keeps a quiet week from magnifying noise into a dramatic-looking spread.
  return Math.max(0.05, max * 1.15);
}

export function buildSurpriseScatter(rows: readonly EarningsAnalyticsRow[]): SurpriseScatter {
  const points: ScatterPoint[] = [];
  let incomplete = 0;
  let pending = 0;
  const counts = { double_beat: 0, eps_beat_rev_miss: 0, eps_miss_rev_beat: 0, double_miss: 0 };

  for (const row of rows) {
    if (!hasPrinted(row)) {
      pending++;
      continue;
    }
    const q = surpriseQuadrant(row.eps_surprise_pct, row.revenue_surprise_pct);
    if (q === "incomplete") {
      incomplete++;
      continue;
    }
    counts[q]++;
    points.push({
      ticker: row.ticker,
      company: row.company_name ?? null,
      date: row.date,
      eps_surprise_pct: row.eps_surprise_pct as number,
      rev_surprise_pct: row.revenue_surprise_pct as number,
      importance: row.importance ?? 0,
      quadrant: q,
    });
  }

  // Biggest absolute movers first so the labelled/annotated points are the ones that matter.
  points.sort(
    (a, b) =>
      Math.abs(b.eps_surprise_pct) + Math.abs(b.rev_surprise_pct) -
      (Math.abs(a.eps_surprise_pct) + Math.abs(a.rev_surprise_pct))
  );

  return { points, incomplete, pending, counts, bound: scatterBound(points) };
}

export type CalendarCell = {
  date: string;
  /** Every row on that date, importance-desc then ticker for a stable render. */
  rows: EarningsAnalyticsRow[];
  total: number;
  megaCap: number;
  printed: number;
  /** Mean EPS surprise % across PRINTED rows only — null when nothing has printed yet. */
  avgEpsSurprisePct: number | null;
  sessions: Record<PrintSession, number>;
};

/**
 * Day-bucketed calendar grid.
 *
 * `avgEpsSurprisePct` deliberately averages only rows that PRINTED. Including pending rows as zero
 * would drag every forward day toward "in line" and paint an un-printed Friday the same colour as a
 * genuinely in-line one. A day with nothing printed returns null and renders unshaded.
 */
export function buildCalendarGrid(rows: readonly EarningsAnalyticsRow[]): CalendarCell[] {
  const byDate = new Map<string, EarningsAnalyticsRow[]>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }

  const cells: CalendarCell[] = [];
  for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.ticker.localeCompare(b.ticker));
    const sessions: Record<PrintSession, number> = { pre: 0, post: 0, intraday: 0, unknown: 0 };
    let printed = 0;
    let surpriseSum = 0;
    let surpriseN = 0;
    let megaCap = 0;
    for (const r of list) {
      sessions[classifyPrintSession(r.time)]++;
      if ((r.importance ?? 0) >= 4) megaCap++;
      if (hasPrinted(r)) {
        printed++;
        if (r.eps_surprise_pct != null && Number.isFinite(r.eps_surprise_pct)) {
          surpriseSum += r.eps_surprise_pct;
          surpriseN++;
        }
      }
    }
    cells.push({
      date,
      rows: list,
      total: list.length,
      megaCap,
      printed,
      avgEpsSurprisePct: surpriseN > 0 ? surpriseSum / surpriseN : null,
      sessions,
    });
  }
  return cells;
}

export type StreakEntry = {
  date: string;
  fiscal: string | null;
  eps_surprise_pct: number | null;
  rev_surprise_pct: number | null;
  beat: boolean | null;
};

export type BeatMissStreak = {
  ticker: string;
  entries: StreakEntry[];
  /** Consecutive beats (positive) or misses (negative) ending at the MOST RECENT print. 0 = none. */
  currentStreak: number;
  beats: number;
  misses: number;
  graded: number;
  beatRate: number | null;
  avgEpsSurprisePct: number | null;
};

/**
 * Per-ticker beat/miss history, oldest → newest.
 *
 * `beat` is null (not false) when a print has no EPS surprise: an ungraded print is not a miss, and
 * counting it as one would understate every name whose surprise Benzinga never populated. Those
 * rows still appear in the timeline as neutral marks so the row's history is not silently shortened.
 */
export function buildBeatMissStreak(
  ticker: string,
  rows: readonly EarningsAnalyticsRow[]
): BeatMissStreak {
  const mine = rows
    .filter((r) => r.ticker === ticker && hasPrinted(r))
    .sort((a, b) => a.date.localeCompare(b.date));

  const entries: StreakEntry[] = mine.map((r) => {
    const eps = r.eps_surprise_pct != null && Number.isFinite(r.eps_surprise_pct) ? r.eps_surprise_pct : null;
    return {
      date: r.date,
      fiscal: r.fiscal_period && r.fiscal_year ? `${r.fiscal_period} ${r.fiscal_year}` : null,
      eps_surprise_pct: eps,
      rev_surprise_pct:
        r.revenue_surprise_pct != null && Number.isFinite(r.revenue_surprise_pct)
          ? r.revenue_surprise_pct
          : null,
      beat: eps == null ? null : eps >= 0,
    };
  });

  let beats = 0;
  let misses = 0;
  let sum = 0;
  for (const e of entries) {
    if (e.beat === true) beats++;
    else if (e.beat === false) misses++;
    if (e.eps_surprise_pct != null) sum += e.eps_surprise_pct;
  }
  const graded = beats + misses;

  // Streak walks backwards from the newest GRADED print. An ungraded print breaks the walk rather
  // than being skipped — "3 straight beats" must mean three consecutive prints, not three beats
  // with an unknown quarter quietly hidden between them.
  let currentStreak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const b = entries[i]!.beat;
    if (b == null) break;
    if (currentStreak === 0) currentStreak = b ? 1 : -1;
    else if (b && currentStreak > 0) currentStreak++;
    else if (!b && currentStreak < 0) currentStreak--;
    else break;
  }

  return {
    ticker,
    entries,
    currentStreak,
    beats,
    misses,
    graded,
    beatRate: graded > 0 ? beats / graded : null,
    avgEpsSurprisePct: graded > 0 ? sum / graded : null,
  };
}

export type PrintClockEntry = {
  ticker: string;
  company: string | null;
  date: string;
  time: string | null;
  session: PrintSession;
  importance: number;
  confirmed: boolean;
  estimated_eps: number | null;
  /** Minutes from `nowMs` until the print. Negative = already passed. Null when time is unknown. */
  minutesUntil: number | null;
  printed: boolean;
};

/**
 * The next-N-hours print clock, sorted soonest-first.
 *
 * Takes `nowMs` as a parameter rather than reading the clock: a component that calls Date.now()
 * internally cannot be tested and re-renders non-deterministically. The caller owns "now".
 *
 * Rows whose time is unknown are kept (with `minutesUntil: null`) and sorted last. Dropping them
 * would hide a confirmed mega-cap print purely because Benzinga has not stamped its hour yet.
 */
export function buildPrintClock(
  rows: readonly EarningsAnalyticsRow[],
  nowMs: number,
  horizonHours = 24
): PrintClockEntry[] {
  const out: PrintClockEntry[] = [];
  for (const r of rows) {
    const session = classifyPrintSession(r.time);
    // ET wall-clock -> epoch. -04:00 is ET daylight time; the app is US-market-only and every other
    // Meridian surface already assumes ET, so this matches rather than inventing a second convention.
    const stamp = r.time ? Date.parse(`${r.date}T${r.time}-04:00`) : NaN;
    const minutesUntil = Number.isFinite(stamp) ? Math.round((stamp - nowMs) / 60000) : null;
    if (minutesUntil != null && (minutesUntil < -60 || minutesUntil > horizonHours * 60)) continue;
    out.push({
      ticker: r.ticker,
      company: r.company_name ?? null,
      date: r.date,
      time: r.time ?? null,
      session,
      importance: r.importance ?? 0,
      confirmed: (r.date_status ?? "").toLowerCase() === "confirmed",
      estimated_eps: r.estimated_eps ?? null,
      minutesUntil,
      printed: hasPrinted(r),
    });
  }
  out.sort((a, b) => {
    if (a.minutesUntil == null && b.minutesUntil == null) return (b.importance ?? 0) - (a.importance ?? 0);
    if (a.minutesUntil == null) return 1;
    if (b.minutesUntil == null) return -1;
    return a.minutesUntil - b.minutesUntil;
  });
  return out;
}

export type WeekPulse = {
  total: number;
  megaCap: number;
  confirmed: number;
  printed: number;
  beats: number;
  misses: number;
  beatRate: number | null;
  avgEpsSurprisePct: number | null;
  medianEpsSurprisePct: number | null;
  busiestDate: string | null;
  busiestCount: number;
};

/** Median that returns null on an empty set rather than NaN — NaN renders as "NaN%" on a panel. */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

/** Headline roll-up for the top-of-dashboard stat strip. */
export function buildWeekPulse(rows: readonly EarningsAnalyticsRow[]): WeekPulse {
  let megaCap = 0;
  let confirmed = 0;
  let printed = 0;
  let beats = 0;
  let misses = 0;
  const surprises: number[] = [];
  const byDate = new Map<string, number>();

  for (const r of rows) {
    if ((r.importance ?? 0) >= 4) megaCap++;
    if ((r.date_status ?? "").toLowerCase() === "confirmed") confirmed++;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
    if (!hasPrinted(r)) continue;
    printed++;
    const e = r.eps_surprise_pct;
    if (e != null && Number.isFinite(e)) {
      surprises.push(e);
      if (e >= 0) beats++;
      else misses++;
    }
  }

  let busiestDate: string | null = null;
  let busiestCount = 0;
  for (const [d, n] of byDate) {
    if (n > busiestCount) {
      busiestCount = n;
      busiestDate = d;
    }
  }

  const graded = beats + misses;
  return {
    total: rows.length,
    megaCap,
    confirmed,
    printed,
    beats,
    misses,
    beatRate: graded > 0 ? beats / graded : null,
    avgEpsSurprisePct: surprises.length ? surprises.reduce((a, b) => a + b, 0) / surprises.length : null,
    medianEpsSurprisePct: median(surprises),
    busiestDate,
    busiestCount,
  };
}

/** Format a fractional surprise (0.0447) as a signed percent string. Null → em-dash, never "0%". */
export function fmtSurprisePct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/** Compact money for revenue magnitudes. Null → em-dash. */
export function fmtCompactMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** "in 2h 14m" / "12m ago" / "time TBD". Pure — takes the already-computed minute delta. */
export function fmtCountdown(minutesUntil: number | null | undefined): string {
  if (minutesUntil == null || !Number.isFinite(minutesUntil)) return "time TBD";
  const past = minutesUntil < 0;
  const m = Math.abs(minutesUntil);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const body = h > 0 ? `${h}h ${rem}m` : `${rem}m`;
  return past ? `${body} ago` : `in ${body}`;
}
