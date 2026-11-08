/**
 * Deploy-smoke pass rules for the authenticated GET /api/market/spx/desk probe.
 * Extracted for unit tests — keep in sync with scripts/gha-http-smoke.mjs.
 */

/** @typedef {Record<string, unknown> | null | undefined} JsonBody */

/**
 * @param {number} status
 * @param {JsonBody} body
 * @returns {{ pass: boolean; kind: "live-price" | "off-hours" | "gated" | "fail" }}
 */
export function evaluateSpxDeskCronProbe(status, body) {
  if (status === 401 || status === 403) {
    return { pass: true, kind: "gated" };
  }
  if (status !== 200 || !body || typeof body !== "object") {
    return { pass: false, kind: "fail" };
  }
  const price = Number(body.price);
  if (Number.isFinite(price) && price > 0) {
    return { pass: true, kind: "live-price" };
  }
  const priorClose = Number(body.prior_close);
  if (Number.isFinite(priorClose) && priorClose > 0) {
    return { pass: true, kind: "off-hours" };
  }
  return { pass: false, kind: "fail" };
}
