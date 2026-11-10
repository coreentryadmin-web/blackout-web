/**
 * Cron staleness watchdog verdict for CI audits (gha-rth-audit, full-site-deep-audit).
 * Mirrors ops-collect: P0 only on `rth_stale_keys` (and critical error spikes); phase-
 * anchored / handshake-only problems during RTH warn but do not fail CI.
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

  const shouldFail = failKeys.length > 0 || criticalErrorSpike;

  return {
    rthStale,
    nonRthProblems,
    failKeys,
    warnKeys: nonRthProblems,
    criticalErrorSpike,
    shouldFail,
    summary:
      failKeys.length > 0
        ? `RTH stale: ${failKeys.join(", ")}`
        : criticalErrorSpike
          ? `error_spike=${body.error_spike}`
          : nonRthProblems.length > 0
            ? inRth
              ? `off-window problems (warn): ${nonRthProblems.join(", ")}`
              : `off-hours problems (ignored): ${nonRthProblems.join(", ")}`
            : "ok",
  };
}
