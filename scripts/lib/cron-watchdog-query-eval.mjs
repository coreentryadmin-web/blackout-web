/** How cron-audit-query should fail from watchdog JSON — same RTH discipline as gha-rth-audit. */

export function cronWatchdogQueryExitProblems(body, { inCashRthSession }) {
  const rthStaleKeys = (body.rth_stale_keys ?? []).filter(Boolean);
  const problemKeys = (body.problem_keys ?? []).filter(Boolean);
  if (inCashRthSession) {
    return [...new Set([...problemKeys, ...rthStaleKeys])];
  }
  return [...new Set(rthStaleKeys)];
}

export function cronWatchdogQueryShouldFail(body, problems) {
  if (body.error_spike === "critical") return true;
  return problems.length > 0;
}
