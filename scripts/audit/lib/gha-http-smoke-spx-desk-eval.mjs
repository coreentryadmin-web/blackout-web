/**
 * Deploy-smoke verdict for cron-authenticated GET /api/market/spx/desk.
 * Pure — unit-tested. The route can return HTTP 200 with price 0 / available:false off-hours
 * while auth still proves the deploy is live (Nov 2026 weekend smoke false alarm).
 *
 * @typedef {"live" | "gated" | "degraded" | "fail"} SpxDeskSmokeVerdict
 */

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {{ ok: boolean; verdict: SpxDeskSmokeVerdict; warn?: string }}
 */
export function spxDeskCronSmokeVerdict(status, body) {
  if (status === 200 && typeof body === "object" && body !== null && !Array.isArray(body)) {
    const price = Number(body.price);
    if (Number.isFinite(price) && price > 0) {
      return { ok: true, verdict: "live" };
    }
    return {
      ok: true,
      verdict: "degraded",
      warn:
        "Cron auth ok but desk has no live spot (off-hours / cold cache / degraded snapshot) — deploy route is up",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: true,
      verdict: "gated",
      warn: "Route up + gated; CI CRON_SECRET may not match prod",
    };
  }
  return { ok: false, verdict: "fail" };
}
