/**
 * Gate for validate-deploy's optional post-deploy `?force=1` cache-warmer probes.
 *
 * Those probes bypass the cache-warmer hours gate server-side. When many Cloud Agents run
 * validate:deploy off-hours (weekends especially), they hammer desk-warm and inflate ALB p99.
 * Only run force warms inside the same extended weekday window the production warmers use.
 *
 * Mirrored (not imported — this .mjs runs via plain `node`, no tsx/path-alias resolution) from
 * `US_MARKET_HOLIDAYS` in src/features/nighthawk/lib/session.ts. Keep in lockstep: a NYSE full-day
 * closure that falls on a weekday (e.g. Labor Day) previously read as "allowed" here because this
 * gate only checked weekday+hour, never the holiday calendar — confirmed LIVE 2026-09-07 (Labor
 * Day, a Monday): validate:deploy-class scripts kept hammering `desk-warm?force=1` roughly every
 * 20-90s all session (CloudWatch `[cache-warmer-gate] force=1 bypassed the hours gate` — dozens of
 * distinct source IPs, `ua=node`), each run taking 5-94s, driving ALB TargetResponseTime p99 to
 * 78s / Max to 100s in the worst 30-min window — while the server-side warmers this gate exists to
 * mirror correctly stayed off all day via `isEtExtendedWarmHours`'s holiday-aware `isTradingDayEt`.
 */
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
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
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

/** @param {Date} [now] */
export function isDeployCacheWarmAllowed(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;

  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  if (US_MARKET_HOLIDAYS.has(ymd)) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  // Match isEtExtendedWarmHours: weekday 4:00 AM–8:00 PM ET, NYSE holidays excluded above.
  return mins >= 4 * 60 && mins <= 20 * 60;
}
