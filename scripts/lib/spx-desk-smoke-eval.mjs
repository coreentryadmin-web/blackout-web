/**
 * Deploy-smoke verdict for GET /api/market/spx/desk (authenticated with CRON bearer).
 * Extracted for unit tests — keep in sync with scripts/gha-http-smoke.mjs inline comments.
 */

/** Minimal shape guard for a real SpxDeskPayload JSON body (not HTML/error wrapper). */
export function isSpxDeskSmokeBody(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.available === "boolean" &&
    typeof body.as_of === "string" &&
    typeof body.source === "string" &&
    typeof body.price === "number" &&
    Number.isFinite(body.price)
  );
}

/**
 * @returns {{ outcome: "pass" | "warn" | "fail", message: string }}
 */
export function spxDeskSmokeVerdict(status, body) {
  if (status === 401 || status === 403) {
    return {
      outcome: "warn",
      message: `${status} (route up + gated; CI CRON_SECRET may not match deployed value)`,
    };
  }
  if (status !== 200) {
    return { outcome: "fail", message: String(status) };
  }
  if (body?.price > 0) {
    return { outcome: "pass", message: `SPX ${body.price} (cron auth ok)` };
  }
  if (!isSpxDeskSmokeBody(body)) {
    return { outcome: "fail", message: "200 but body is not a desk payload" };
  }
  // Off-hours / weekend shells can be honest with price:0 — auth worked, route built JSON.
  if (body.market_open === true && body.price <= 0) {
    return {
      outcome: "fail",
      message: "200 during market_open with price≤0 (live spot missing)",
    };
  }
  return {
    outcome: "warn",
    message: `200 price=${body.price} market_open=${body.market_open ?? "?"} (cron ok; off-hours shell)`,
  };
}
