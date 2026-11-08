/**
 * Pure verdict helpers for deploy-smoke's authenticated /api/market/spx/desk probe.
 * Extracted so off-hours vs RTH expectations stay unit-tested (CI red 2026-11-08: Sunday 200
 * with price:0/degraded shell tripped `body?.price > 0` while the route and cron auth were fine).
 */

export function isEtCashRth(now = new Date()) {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (wd === "Sat" || wd === "Sun") return false;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

/** True when the desk JSON carries a member-visible index level (live spot or frozen prior close). */
export function spxDeskHasGroundedSpot(body) {
  if (!body || typeof body !== "object") return false;
  const price = Number(body.price);
  const prior = Number(body.prior_close);
  return (Number.isFinite(price) && price > 0) || (Number.isFinite(prior) && prior > 0);
}

/**
 * @returns {"pass_live"|"pass_offhours"|"warn_auth_drift"|"fail"}
 */
export function spxDeskSmokeVerdict(status, body, now = new Date()) {
  if (status === 401 || status === 403) return "warn_auth_drift";
  if (status !== 200 || typeof body !== "object" || body === null || body.error) return "fail";
  if (spxDeskHasGroundedSpot(body)) return "pass_live";
  if (!isEtCashRth(now)) return "pass_offhours";
  return "fail";
}
