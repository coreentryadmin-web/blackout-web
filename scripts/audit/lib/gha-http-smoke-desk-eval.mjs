/**
 * Verdict helper for deploy-smoke's authenticated /api/market/spx/desk probe.
 * Deploy smoke should catch route loss (404) and crashes (5xx), not demand a live
 * RTH spot on weekends or immediately after a cold deploy when desk may honestly
 * return available:false or price 0 until caches warm.
 */

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {{ verdict: "pass" | "warn" | "fail"; detail: string }}
 */
export function evaluateSpxDeskSmoke(status, body) {
  if (status === 401 || status === 403) {
    return {
      verdict: "warn",
      detail: `route up + gated; CI CRON_SECRET may not match deployed value`,
    };
  }

  if (typeof status !== "number" || status <= 0) {
    return { verdict: "fail", detail: `non-numeric or zero HTTP status` };
  }

  if (status === 404 || status >= 500) {
    return { verdict: "fail", detail: `broken deploy (${status})` };
  }

  if (status !== 200) {
    return { verdict: "fail", detail: `unexpected status ${status}` };
  }

  if (!isDeskJson(body)) {
    return { verdict: "fail", detail: "200 but body is not a desk JSON payload" };
  }

  const price = /** @type {{ price?: unknown }} */ (body).price;
  if (typeof price === "number" && price > 0) {
    return { verdict: "pass", detail: `SPX ${price} (cron auth ok)` };
  }

  return {
    verdict: "warn",
    detail:
      "route up; desk JSON without a live spot (off-hours, cold cache, or degraded availability — not a deploy outage)",
  };
}

/**
 * @param {unknown} body
 */
function isDeskJson(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return "available" in body || "price" in body || "source" in body || "polled_at" in body;
}
