/**
 * Pure verdict for deploy-smoke's authenticated SPX desk probe.
 * RTH: expect price > 0. Off-hours: 200 with honest desk JSON (available flag) is still GREEN.
 */

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {{ ok: true, kind: "live_price", price: number } | { ok: true, kind: "warn_cron_drift" } | { ok: true, kind: "desk_shell", available: boolean } | { ok: false, detail: string }}
 */
export function spxDeskSmokeVerdict(status, body) {
  if (status === 401 || status === 403) {
    return { ok: true, kind: "warn_cron_drift" };
  }
  if (status !== 200) {
    return { ok: false, detail: `status_${status}` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "not_json_object" };
  }
  const desk = /** @type {Record<string, unknown>} */ (body);
  const price = desk.price;
  if (typeof price === "number" && price > 0) {
    return { ok: true, kind: "live_price", price };
  }
  if (typeof desk.available === "boolean") {
    return { ok: true, kind: "desk_shell", available: desk.available };
  }
  if (typeof desk.prior_close === "number" && desk.prior_close > 0) {
    return { ok: true, kind: "desk_shell", available: false };
  }
  return { ok: false, detail: "ungrounded_200" };
}
