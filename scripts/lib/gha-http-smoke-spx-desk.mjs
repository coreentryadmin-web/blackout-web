/**
 * Pure verdict for deploy-smoke's authenticated /api/market/spx/desk probe.
 * Extracted for unit tests — keep in sync with scripts/gha-http-smoke.mjs.
 */

/**
 * @param {{ status: number, body: unknown }} probe
 * @returns {{ pass: boolean, kind: "live_price" | "reachable_off_hours" | "secret_drift" | "fail"; detail?: string }}
 */
export function classifySpxDeskCronProbe(probe) {
  const { status, body } = probe;
  if (status === 200 && body && typeof body === "object" && !Array.isArray(body)) {
    const price = Number(/** @type {{ price?: number }} */ (body).price ?? 0);
    if (price > 0) return { pass: true, kind: "live_price" };
    return { pass: true, kind: "reachable_off_hours" };
  }
  if (status === 401 || status === 403) {
    return { pass: true, kind: "secret_drift" };
  }
  return { pass: false, kind: "fail", detail: String(status) };
}
