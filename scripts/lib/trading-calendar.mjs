/** NYSE trading calendar for audit scripts — keep in sync with src/lib/nighthawk/session.ts */
const ET = "America/New_York";

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
]);

export function formatEtDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(now);
}

export function isMarketHolidayEt(ymd) {
  return US_MARKET_HOLIDAYS.has(ymd);
}

export function isTradingDayEt(now = new Date()) {
  const ymd = formatEtDate(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return !isMarketHolidayEt(ymd);
}

/** Writer crons + live heatmap matrices are not expected on full market closures. */
export function expectLiveMarketWriters(now = new Date()) {
  return isTradingDayEt(now);
}
