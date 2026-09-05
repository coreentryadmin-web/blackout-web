/**
 * Gate for validate-deploy's optional post-deploy `?force=1` cache-warmer probes.
 *
 * Those probes bypass the cache-warmer hours gate server-side. When many Cloud Agents run
 * validate:deploy off-hours (weekends especially), they hammer desk-warm and inflate ALB p99.
 * Only run force warms inside the same extended weekday window the production warmers use.
 */

/** @param {Date} [now] */
export function isDeployCacheWarmAllowed(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  // Match isEtExtendedWarmHours: weekday 4:00 AM–8:00 PM ET (NYSE holidays not modeled here).
  return mins >= 4 * 60 && mins <= 20 * 60;
}
