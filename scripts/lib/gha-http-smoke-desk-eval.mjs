/**
 * Pure verdict logic for deploy-smoke's authenticated GET /api/market/spx/desk probe.
 * Separated for unit tests — keep in sync with scripts/gha-http-smoke.mjs.
 *
 * @returns {"pass"|"warn"|"fail"} outcome plus a short log detail
 */
export function spxDeskCronSmokeVerdict(status, body) {
  if (status === 200 && typeof body?.price === "number" && body.price > 0) {
    return { outcome: "pass", detail: `SPX ${body.price}` };
  }
  if (status === 401 || status === 403) {
    return { outcome: "warn", code: "cron_secret_drift", detail: String(status) };
  }
  if (status === 200 && body && typeof body === "object" && !body.error) {
    const priorClose =
      typeof body.prior_close === "number" && Number.isFinite(body.prior_close) && body.prior_close > 0
        ? body.prior_close
        : null;
    if (priorClose != null) {
      return { outcome: "pass", detail: `prior_close ${priorClose}` };
    }
    const deskPayload =
      typeof body.available === "boolean" ||
      typeof body.source === "string" ||
      typeof body.as_of === "string";
    if (deskPayload) {
      return {
        outcome: "warn",
        code: "off_hours_no_spot",
        detail: `price=${body.price ?? "null"} market_open=${String(body.market_open)}`,
      };
    }
  }
  if (status === 404 || status >= 500) {
    return { outcome: "fail", detail: String(status) };
  }
  return { outcome: "fail", detail: String(status) };
}
