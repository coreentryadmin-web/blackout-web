/**
 * Monthly OPEX (options expiration) dates for the historical chart.
 *
 * WHY THIS IS A FIRST-CLASS MARKER ON A GAMMA PRODUCT. Standard monthly options expire on the
 * THIRD FRIDAY. On that date a large block of open interest — and the dealer gamma hedging it
 * implies — stops existing. Pinning pressure that held price all week evaporates, and the days
 * around it behave differently from the rest of the month. On a chart whose entire premise is
 * dealer positioning, an unmarked OPEX is a missing explanatory variable: it is the single most
 * recurring structural event in the calendar.
 *
 * Third Friday, not "the Friday nearest the 15th": those differ whenever the 1st falls on a
 * Saturday, so getting it wrong misplaces the marker by a week several times a year.
 *
 * All dates are computed in UTC and returned as YYYY-MM-DD. Bars carry UTC-midnight timestamps
 * for daily aggregates, so mixing a local-time Date here would shift markers by a day for anyone
 * west of UTC.
 */

/** The third Friday of `month` (1-12) in `year`, as YYYY-MM-DD. */
export function thirdFriday(year: number, month: number): string {
  // Day-of-week of the 1st, 0=Sun … 5=Fri.
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  // Days to the FIRST Friday: 0 if the 1st is already Friday, else the forward distance.
  const toFirstFriday = (5 - firstDow + 7) % 7;
  const day = 1 + toFirstFriday + 14; // first Friday + two weeks
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Every monthly OPEX date within [fromMs, toMs] (epoch ms, inclusive), ascending.
 *
 * Bounded by the bar range the chart actually loaded, so a 2-year daily history yields ~24
 * markers and a 30-session 4H history yields one or two — the caller never has to filter.
 */
export function opexDatesInRange(fromMs: number, toMs: number): string[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const out: string[] = [];
  const start = new Date(fromMs);
  const end = new Date(toMs);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth() + 1;
  // Walk month by month. Bounded by construction: at most ~12 iterations per year of range.
  while (y < endY || (y === endY && m <= endM)) {
    const d = thirdFriday(y, m);
    const ts = Date.parse(`${d}T00:00:00Z`);
    if (ts >= fromMs && ts <= toMs) out.push(d);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Quarterly OPEX (Mar/Jun/Sep/Dec) — "triple witching", where index futures, index options and
 *  stock options all expire together. Materially larger unwind than a normal monthly, so it is
 *  worth drawing with more weight than the other nine. */
export function isQuarterlyOpex(isoDate: string): boolean {
  const m = Number(isoDate.slice(5, 7));
  return m === 3 || m === 6 || m === 9 || m === 12;
}
