/**
 * Bounded UTC cron windows (railway.*.toml / EventBridge catalog).
 * Suppresses stale watchdog noise when no fire is scheduled — same idea as
 * market_hours_only off-window suppression in admin-cron-health.ts.
 */

const DOW_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function parseIntList(field: string, min: number, max: number): number[] {
  if (field === "*" || field === "?") {
    const out: number[] = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (stepMatch) {
      const start = Number(stepMatch[1]);
      const end = Number(stepMatch[2]);
      const step = Number(stepMatch[3]);
      for (let v = start; v <= end; v += step) out.add(v);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let v = start; v <= end; v++) out.add(v);
      continue;
    }
    const starStep = part.match(/^\*\/(\d+)$/);
    if (starStep) {
      const step = Number(starStep[1]);
      for (let v = min; v <= max; v += step) out.add(v);
      continue;
    }
    const stepOnly = part.match(/^(\d+)\/(\d+)$/);
    if (stepOnly) {
      // "N/M" (no range, no leading "*") means "start at N, repeat every M" — same convention
      // the `starStep` ("*/M", start = field min) and `stepMatch` ("A-B/M", start = A) branches
      // right above already honor. The start value is group 1, not the field's bare `min`.
      const start = Number(stepOnly[1]);
      const step = Number(stepOnly[2]);
      for (let v = start; v <= max; v += step) out.add(v);
      continue;
    }
    out.add(Number(part));
  }
  return [...out].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
}

function parseDow(field: string): Set<number> | null {
  if (field === "*" || field === "?") return null;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      for (let v = Number(rangeMatch[1]); v <= Number(rangeMatch[2]); v++) out.add(v % 7);
      continue;
    }
    const named = DOW_NAMES[part.toUpperCase()];
    if (named != null) {
      out.add(named);
      continue;
    }
    out.add(Number(part) % 7);
  }
  return out;
}

function enumerateFiresOnUtcDay(
  minuteField: string,
  hourField: string,
  dowField: string,
  year: number,
  month: number,
  date: number
): Date[] {
  const day = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
  const dow = day.getUTCDay();
  const allowedDow = parseDow(dowField);
  if (allowedDow && !allowedDow.has(dow)) return [];

  const minutes = parseIntList(minuteField, 0, 59);
  const hours = parseIntList(hourField, 0, 23);
  const fires: Date[] = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      fires.push(new Date(Date.UTC(year, month, date, hour, minute, 0, 0)));
    }
  }
  return fires.sort((a, b) => a.getTime() - b.getTime());
}

function dailyFireBounds(cronExpr: string, now: Date): { first: Date; last: Date } | null {
  const [minuteField, hourField, , , dowField] = cronExpr.trim().split(/\s+/);
  if (!minuteField || !hourField || !dowField) return null;
  const fires = enumerateFiresOnUtcDay(
    minuteField,
    hourField,
    dowField,
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  if (!fires.length) return null;
  return { first: fires[0]!, last: fires[fires.length - 1]! };
}

/**
 * True when `now` sits in a long idle gap where no EventBridge tick is scheduled.
 * Short intra-band gaps (hourly :20, every 30m) still page on a missed fire.
 */
export function isInOffScheduleIdleGap(cronExpr: string, now = new Date()): boolean {
  const last = lastExpectedCronFireUtc(cronExpr, now);
  const next = nextExpectedCronFireUtc(cronExpr, now);
  if (!last || !next) {
    const bounds = dailyFireBounds(cronExpr, now);
    if (!bounds) return true;
    const t = now.getTime();
    return t < bounds.first.getTime() || t > bounds.last.getTime();
  }
  const gapMs = next.getTime() - last.getTime();
  const longGapMs = 2 * 60 * 60_000;
  if (gapMs <= longGapMs) return false;
  const t = now.getTime();
  return t > last.getTime() && t < next.getTime();
}

/**
 * True between two same-day UTC fires when the gap is short (dual-band DST schedules like
 * `0 13,14 * * 1-5`). Only ONE band lands in the route's ET window in each offset; the other
 * intentionally no-ops. While `now` sits after the first band but before the second, the
 * meaningful in-window run has not been due yet — do not page stale on age from a prior session.
 */
export function isInDualBandSameDayGrace(cronExpr: string, now = new Date()): boolean {
  const last = lastExpectedCronFireUtc(cronExpr, now);
  const next = nextExpectedCronFireUtc(cronExpr, now);
  if (!last || !next) return false;
  if (
    last.getUTCFullYear() !== now.getUTCFullYear() ||
    last.getUTCMonth() !== now.getUTCMonth() ||
    last.getUTCDate() !== now.getUTCDate()
  ) {
    return false;
  }
  if (
    next.getUTCFullYear() !== now.getUTCFullYear() ||
    next.getUTCMonth() !== now.getUTCMonth() ||
    next.getUTCDate() !== now.getUTCDate()
  ) {
    return false;
  }
  const gapMs = next.getTime() - last.getTime();
  const dualBandMaxGapMs = 2 * 60 * 60_000;
  if (gapMs <= 0 || gapMs > dualBandMaxGapMs) return false;
  const t = now.getTime();
  return t >= last.getTime() && t < next.getTime();
}

/** Last scheduled fire at or before `now` within the lookback window. */
export function lastExpectedCronFireUtc(cronExpr: string, now = new Date()): Date | null {
  const [minuteField, hourField, , , dowField] = cronExpr.trim().split(/\s+/);
  if (!minuteField || !hourField || !dowField) return null;
  const lookback = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
  const fires: Date[] = [];
  const cursor = new Date(Date.UTC(lookback.getUTCFullYear(), lookback.getUTCMonth(), lookback.getUTCDate()));
  while (cursor.getTime() <= now.getTime()) {
    fires.push(
      ...enumerateFiresOnUtcDay(
        minuteField,
        hourField,
        dowField,
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate()
      )
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const eligible = fires.filter((f) => f.getTime() <= now.getTime());
  return eligible.length ? eligible[eligible.length - 1]! : null;
}

/** Next scheduled fire strictly after `now`. */
export function nextExpectedCronFireUtc(cronExpr: string, now = new Date()): Date | null {
  const [minuteField, hourField, , , dowField] = cronExpr.trim().split(/\s+/);
  if (!minuteField || !hourField || !dowField) return null;
  const lookahead = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
  const fires: Date[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (cursor.getTime() <= lookahead.getTime()) {
    fires.push(
      ...enumerateFiresOnUtcDay(
        minuteField,
        hourField,
        dowField,
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate()
      )
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const eligible = fires.filter((f) => f.getTime() > now.getTime());
  return eligible.length ? eligible[0]! : null;
}
