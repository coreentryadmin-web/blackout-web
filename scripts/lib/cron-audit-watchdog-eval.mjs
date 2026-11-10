/**
 * Which watchdog problem_keys should fail scheduled Cron audit query CI.
 * Off-hours: only market_hours_stale (rth_stale_keys) + critical error spikes — handshake-only
 * stale on phase-anchored jobs (e.g. swing-discovery) must not page at 8 PM ET.
 */

/** @param {{ problem_keys?: string[]; rth_stale_keys?: string[]; error_spike?: string }} body */
export function cronAuditFailKeys(body, { inRth }) {
  const problemKeys = body.problem_keys ?? [];
  const rthStale = body.rth_stale_keys ?? [];
  const keys = new Set(rthStale);
  if (body.error_spike === "critical") {
    for (const k of problemKeys) keys.add(k);
  }
  if (inRth) {
    for (const k of problemKeys) keys.add(k);
  }
  return [...keys];
}
