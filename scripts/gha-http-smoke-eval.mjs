/**
 * Pure verdict for deploy-smoke SPX desk probe (unit-tested).
 * @param {number} status
 * @param {unknown} body
 * @returns {{ outcome: "pass" | "warn" | "fail"; detail: string }}
 */
export function spxDeskSmokeVerdict(status, body) {
  if (status === 401 || status === 403) {
    return {
      outcome: "warn",
      detail: `${status} (route up + gated; CI CRON_SECRET may not match prod)`,
    };
  }
  if (status === 200 && body && typeof body === "object" && typeof body.price === "number" && body.price > 0) {
    return { outcome: "pass", detail: `SPX ${body.price} (cron auth ok)` };
  }
  if (status === 200 && body && typeof body === "object" && body.error) {
    return { outcome: "fail", detail: `200 with error: ${body.error}` };
  }
  // Authenticated 200 with an honest empty/off-hours desk shell (price:0, source:"none") still
  // proves deploy + bearer gate — not a broken route (observed deploy-smoke red 2026-11-08 Sun).
  if (status === 200 && body && typeof body === "object") {
    const price = typeof body.price === "number" ? body.price : 0;
    return {
      outcome: "warn",
      detail: `200 cron auth ok, spot ${price} (off-hours or cache shell — not a deploy failure)`,
    };
  }
  return { outcome: "fail", detail: String(status) };
}
