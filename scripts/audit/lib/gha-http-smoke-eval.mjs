/**
 * Pure helpers for scripts/gha-http-smoke.mjs — kept testable without live fetches.
 */

/** Authenticated SPX desk probe succeeded with a member-visible grounded spot. */
export function spxDeskSmokePass(status, body) {
  if (status === 401 || status === 403) return "auth_drift";
  if (status !== 200) return "fail";
  if (typeof body !== "object" || body === null) return "fail";
  const price = Number(body.price);
  if (Number.isFinite(price) && price > 0) return "ok";
  return "retry";
}
