import { priorEtYmd, todayEtYmd } from "@/lib/providers/spx-session";

const ET = "America/New_York";

/** NYSE full-day closures — extend annually. */
const US_MARKET_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-04-02",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
  // 2028 (Jan 1 falls on Sat — NYSE does not observe)
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
  // 2029
  "2029-01-01",
  "2029-01-15",
  "2029-02-19",
  "2029-03-30",
  "2029-05-28",
  "2029-06-19",
  "2029-07-04",
  "2029-09-03",
  "2029-11-22",
  "2029-12-25",
]);

export function todayEt(): string {
  return todayEtYmd();
}

export function priorEt(): string {
  return priorEtYmd();
}

export function formatEtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
}

export function isMarketHolidayEt(ymd: string): boolean {
  return US_MARKET_HOLIDAYS.has(ymd);
}

export function isTradingDayEt(ymd: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(new Date(`${ymd}T12:00:00`));
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !isMarketHolidayEt(ymd);
}

export function nextTradingDayEt(from?: string): string {
  const start = from ? new Date(`${from}T12:00:00`) : new Date();
  let cursor = new Date(start.getTime() + 86_400_000);
  for (let i = 0; i < 12; i++) {
    const ymd = formatEtDate(cursor);
    if (isTradingDayEt(ymd)) return ymd;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return formatEtDate(cursor);
}

/** Walk backward to the prior NYSE trading day (mirrors nextTradingDayEt). */
export function previousTradingDayEt(from: string): string {
  let cursor = new Date(`${from}T12:00:00`);
  for (let i = 0; i < 12; i++) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    const ymd = formatEtDate(cursor);
    if (isTradingDayEt(ymd)) return ymd;
  }
  return formatEtDate(cursor);
}

/**
 * The most recent trading day at or before `now` (ET calendar date) — walks
 * backward through weekends/holidays, mirroring nextTradingDayEt's forward walk.
 * Used to detect whether a "last captured" snapshot (e.g. market_regime,
 * task #173) is from the current/most-recently-completed trading session, or is
 * a leftover from a prior one (weekend, holiday, cron outage).
 */
export function mostRecentTradingDayEt(now: Date = new Date()): string {
  let ymd = formatEtDate(now);
  for (let i = 0; i < 12; i++) {
    if (isTradingDayEt(ymd)) return ymd;
    const cursor = new Date(`${ymd}T12:00:00`);
    ymd = formatEtDate(new Date(cursor.getTime() - 86_400_000));
  }
  return ymd;
}

export function etNowParts(): { hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/**
 * "YYYY-MM-DD HH:mm ET" for an epoch-ms instant — the READABLE twin of a raw timestamp.
 *
 * WHY THIS EXISTS. A bare epoch on a payload makes the reader guess the session
 * convention, and a reader that guesses wrong misdates the data (see PR #2418: an OHLC
 * bar carrying only `t` produced a dated close off by a full session). Anywhere an
 * epoch is the ONLY time anchor on an object, it needs one of these beside it.
 *
 * Returns null for anything that is not a finite epoch-ms — never a fabricated date,
 * and never the Unix epoch dressed up as a real timestamp.
 */
export function etStampFromMs(tMs: unknown): string | null {
  if (typeof tMs !== "number" || !Number.isFinite(tMs)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (date.includes("NaN") || get("year") === "") return null;
  // Intl renders midnight as "24" in some ICU versions under hour12:false — normalize so a
  // stamp can never read as an hour that does not exist.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${date} ${hour}:${get("minute")} ET`;
}

export function isWeekdayEt(): boolean {
  const { weekday } = etNowParts();
  return weekday !== "Sat" && weekday !== "Sun";
}

export function isBeforeOrAtMarketCloseEt(
  sessionYmd: string | null | undefined,
  now = new Date()
): boolean {
  if (!sessionYmd || !/^\d{4}-\d{2}-\d{2}$/.test(sessionYmd)) return false;
  if (!isTradingDayEt(sessionYmd)) return false;
  if (formatEtDate(now) !== sessionYmd) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins <= 16 * 60;
}
