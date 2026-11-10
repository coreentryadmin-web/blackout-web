/**
 * Which cron-staleness-watchdog keys should fail scheduled cron-audit-query / GHA.
 * Off RTH (after 16:15 ET), only market-hours stale jobs break CI — post-close crons
 * (swing-discovery, nighthawk-outcomes, …) stay visible as P1 in ops:collect.
 */
import { inRthOpenWindow } from "../gha-et-window.mjs";
import { isXMarketingCronSuppressed } from "../audit/lib/x-marketing-paused.mjs";

/** @param {{ problem_keys?: string[]; rth_stale_keys?: string[] }} body */
export function cronAuditWatchdogProblemKeys(body, now = new Date()) {
  const offHours = !inRthOpenWindow(now);
  const keys = offHours
    ? [...new Set(body.rth_stale_keys ?? [])]
    : [...new Set([...(body.problem_keys ?? []), ...(body.rth_stale_keys ?? [])])];
  return keys.filter((key) => !isXMarketingCronSuppressed(key));
}
