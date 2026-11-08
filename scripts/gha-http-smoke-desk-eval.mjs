/**
 * Pure desk-line verdict for deploy-smoke (unit-tested; keep in sync with gha-http-smoke.mjs).
 * @returns {"pass"|"warn"|"fail"}
 */
export function deskSmokeVerdict(status, body) {
  const deskBodyOk =
    status === 200 && typeof body === "object" && body !== null && body.error == null;
  if (deskBodyOk) return "pass";
  if (status === 401 || status === 403) return "warn";
  return "fail";
}
