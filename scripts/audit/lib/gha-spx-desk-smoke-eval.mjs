/**
 * Pure verdict for deploy-smoke's authenticated /api/market/spx/desk probe.
 * Separated so gha-http-smoke.mjs stays a thin runner and we can unit-test
 * without hitting prod.
 *
 * @param {{ status: number, body: unknown }} probe
 * @returns {{ outcome: "pass" | "warn" | "fail", detail?: string }}
 */
export function evaluateSpxDeskSmokeProbe(probe) {
  const { status, body } = probe;

  if (status === 401 || status === 403) {
    return {
      outcome: "warn",
      detail: `route_gated_${status}`,
    };
  }

  if (status !== 200) {
    return { outcome: "fail", detail: `http_${status}` };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { outcome: "fail", detail: "body_not_object" };
  }

  const desk = /** @type {Record<string, unknown>} */ (body);

  if (typeof desk.price === "number" && desk.price > 0) {
    return { outcome: "pass", detail: `price_${desk.price}` };
  }

  if (typeof desk.prior_close === "number" && desk.prior_close > 0) {
    return {
      outcome: "pass",
      detail: `prior_close_${desk.prior_close}`,
    };
  }

  // Honest fail-closed desk (upstream snapshot entitlement loss, etc.) — auth and route work;
  // deploy smoke must not RED on that (measured 2026-11-08: available:false, source:"none").
  if (desk.available === false && typeof desk.as_of === "string" && desk.as_of.length > 0) {
    return { outcome: "warn", detail: "desk_degraded_unavailable" };
  }

  if (desk.available === true) {
    return { outcome: "fail", detail: "available_true_price_zero" };
  }

  return { outcome: "fail", detail: "no_grounded_spot" };
}
