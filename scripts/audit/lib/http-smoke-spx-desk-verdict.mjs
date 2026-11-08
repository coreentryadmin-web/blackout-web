/**
 * Pure verdict for deploy-smoke's optional CRON-authenticated /api/market/spx/desk probe.
 * CI fails only on missing route (404), crash (5xx), or malformed auth response — not when
 * cron auth matches but the desk is honestly off-hours (`price: 0`, `available: false`).
 */

/**
 * @param {number} status HTTP status
 * @param {unknown} body Parsed JSON (or non-object on parse failure)
 * @returns {{ pass: boolean, level: "ok"|"warn"|"fail", label: string }}
 */
export function spxDeskCronSmokeVerdict(status, body) {
  if (status === 200 && typeof body === "object" && body !== null && !Array.isArray(body)) {
    const price = /** @type {{ price?: number }} */ (body).price;
    if (typeof price === "number" && price > 0) {
      return { pass: true, level: "ok", label: `SPX ${price} (cron auth ok)` };
    }
    if (
      "available" in body ||
      "market_open" in body ||
      (typeof price === "number" && price >= 0)
    ) {
      const available = /** @type {{ available?: boolean }} */ (body).available;
      return {
        pass: true,
        level: "warn",
        label: `cron auth ok; no live SPX price (off-hours shell; available=${String(available)})`,
      };
    }
  }
  if (status === 401 || status === 403) {
    return {
      pass: true,
      level: "warn",
      label: `${status} (route up + gated; CI CRON_SECRET may not match deployed value)`,
    };
  }
  return { pass: false, level: "fail", label: String(status) };
}
