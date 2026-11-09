/**
 * Pure verdict helper for deploy-smoke's authenticated /api/market/spx/desk probe.
 * Extracted so GHA off-hours behavior (200 with price 0) is unit-tested without prod fetch.
 */

export function etMinutesAmericaNewYork(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Weekday cash RTH (9:30–4:00 ET) — good enough for deploy smoke; early-close/holiday skew is acceptable. */
export function isApproxUsCashRth(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = etMinutesAmericaNewYork(now);
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

/**
 * @param {{ status: number, body: unknown }} probe
 * @returns {{ outcome: "ok" | "warn" | "fail", message: string }}
 */
export function evaluateSpxDeskSmoke(probe, now = new Date()) {
  const { status, body } = probe;
  const record = body && typeof body === "object" ? body : null;
  const price = record && "price" in record ? Number(record.price) : NaN;

  if (status === 401 || status === 403) {
    return {
      outcome: "warn",
      message:
        `${status} (route up + gated; CI CRON_SECRET may not match deployed value — reconcile to restore live price check)`,
    };
  }

  const prior =
    record && "prior_close" in record ? Number(record.prior_close) : NaN;
  const groundedSpot =
    (Number.isFinite(price) && price > 0) ||
    (Number.isFinite(prior) && prior > 0);

  if (status === 200 && groundedSpot) {
    const spot = Number.isFinite(price) && price > 0 ? price : prior;
    return { outcome: "ok", message: `SPX ${spot} (cron auth ok)` };
  }

  if (status === 200) {
    if (record && record.available === false) {
      return {
        outcome: "warn",
        message: "200 available:false (route up; honest empty desk)",
      };
    }
    if (!isApproxUsCashRth(now)) {
      return {
        outcome: "warn",
        message: `200 price=${Number.isFinite(price) ? price : "—"} (off-hours; live spot not required for deploy smoke)`,
      };
    }
    return {
      outcome: "fail",
      message: `200 but no positive SPX price during cash RTH (price=${Number.isFinite(price) ? price : "—"})`,
    };
  }

  return { outcome: "fail", message: `unexpected HTTP ${status}` };
}
