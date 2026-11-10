/**
 * Cron staleness watchdog verdict for CI audits (cron-audit-query, gha-rth-audit, full-site-deep-audit).
 * Mirrors ops-collect: P0 only on market_hours_stale during RTH; post-close schedule
 * gaps must not fail the deep audit when rth_stale_keys is empty.
 */

/**
 * @param {{ problem_keys?: string[], rth_stale_keys?: string[], error_spike?: string }} body
 * @param {{ inRth: boolean }} ctx
 */
export function evaluateCronWatchdogAudit(body, { inRth }) {
  const rthStale = [...new Set(body.rth_stale_keys ?? [])];
  const problemKeys = [...new Set(body.problem_keys ?? [])];
  const nonRthProblems = problemKeys.filter((k) => !rthStale.includes(k));

  const failKeys = [...rthStale];
  const warnKeys = inRth ? nonRthProblems : nonRthProblems;
  const criticalErrorSpike = body.error_spike === "critical";

  // ops-collect pages non-RTH stale keys as P1 even during RTH (swing-discovery phase gaps).
  // Only market_hours_stale (rth_stale_keys) and critical error spikes are P0 for CI gates.
  const shouldFail = failKeys.length > 0 || criticalErrorSpike;

  return {
    rthStale,
    nonRthProblems,
    failKeys,
    warnKeys: inRth ? [] : nonRthProblems,
    criticalErrorSpike,
    shouldFail,
    summary:
      failKeys.length > 0
        ? `RTH stale: ${failKeys.join(", ")}`
        : criticalErrorSpike
          ? `error_spike=${body.error_spike}`
          : nonRthProblems.length > 0
            ? inRth
              ? `P1 problems (not failing run): ${nonRthProblems.join(", ")}`
              : `off-hours problems (ignored): ${nonRthProblems.join(", ")}`
            : "ok",
  };
}
