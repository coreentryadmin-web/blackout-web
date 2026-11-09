import { inRthOpenWindow } from "../../gha-et-window.mjs";

/**
 * Which watchdog job keys should fail a scheduled audit at `now`.
 * Off-hours: only market-hours-stale jobs (rth_stale_keys), not post-close idleness.
 */
export function watchdogProblemKeysForAudit(watchdogBody, now = new Date()) {
  if (!watchdogBody || typeof watchdogBody !== "object") return [];
  if (inRthOpenWindow(now)) {
    return [...new Set(watchdogBody.problem_keys ?? [])];
  }
  return [...new Set(watchdogBody.rth_stale_keys ?? [])];
}
