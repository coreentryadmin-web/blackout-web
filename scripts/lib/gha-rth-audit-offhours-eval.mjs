/**
 * Pure helpers for GHA RTH audit off-hours gating (scheduled runs can slip past 16:15 ET).
 */

/** Deep numeric audit requires live cash-session prices — skip off RTH unless forced. */
export function shouldRunFullSiteDeepAudit({ rthOpen, force, smokeOnly }) {
  if (smokeOnly) return false;
  return Boolean(rthOpen || force);
}

/**
 * Off-hours: only RTH-stale market-hour crons are actionable; post-close / idle-gap problems are warnings.
 * @returns {{ failKeys: string[], warnKeys: string[] }}
 */
export function cronWatchdogVerdict({ rthOpen, force, problemKeys = [], rthStaleKeys = [] }) {
  const problems = [...new Set(problemKeys)];
  const rthStale = [...new Set(rthStaleKeys)];
  if (force || rthOpen) {
    return { failKeys: problems, warnKeys: [] };
  }
  if (rthStale.length > 0) {
    return { failKeys: rthStale, warnKeys: problems.filter((k) => !rthStale.includes(k)) };
  }
  return { failKeys: [], warnKeys: problems };
}
