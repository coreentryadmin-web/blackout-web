/**
 * Cron staleness watchdog verdict for CI audits (cron-audit-query, gha-rth-audit, full-site-deep-audit).
 * Mirrors ops-collect: P0 only on market_hours_stale during RTH; post-close schedule
 * gaps must not fail the deep audit when rth_stale_keys is empty.
 */

/** Handshake lags; serving snapshot + phase idempotency are the member-facing truth. */
const PHASE_ANCHORED_WATCHDOG_KEYS = new Set(["swing-discovery"]);

/**
 * @param {{ problem_keys?: string[], rth_stale_keys?: string[], error_spike?: string }} body
 * @param {{ inRth: boolean }} ctx
 */
export function evaluateCronWatchdogAudit(body, { inRth }) {
  const rthStale = [...new Set(body.rth_stale_keys ?? [])];
  const problemKeys = [...new Set(body.problem_keys ?? [])];
  const nonRthProblems = problemKeys.filter((k) => !rthStale.includes(k));
  const phaseAnchoredProblems = nonRthProblems.filter((k) => PHASE_ANCHORED_WATCHDOG_KEYS.has(k));
  const actionableNonRthProblems = nonRthProblems.filter((k) => !PHASE_ANCHORED_WATCHDOG_KEYS.has(k));

  const failKeys = [...rthStale];
  const criticalErrorSpike = body.error_spike === "critical";

  const shouldFail =
    failKeys.length > 0 ||
    criticalErrorSpike ||
    (inRth && actionableNonRthProblems.length > 0);

  return {
    rthStale,
    nonRthProblems: actionableNonRthProblems,
    phaseAnchoredProblems,
    failKeys,
    warnKeys: inRth ? phaseAnchoredProblems : nonRthProblems,
    criticalErrorSpike,
    shouldFail,
    summary:
      failKeys.length > 0
        ? `RTH stale: ${failKeys.join(", ")}`
        : criticalErrorSpike
          ? `error_spike=${body.error_spike}`
          : nonRthProblems.length > 0
            ? inRth
              ? `problems: ${nonRthProblems.join(", ")}`
              : `off-hours problems (ignored): ${nonRthProblems.join(", ")}`
            : phaseAnchoredProblems.length > 0
              ? `phase-anchored (warn only): ${phaseAnchoredProblems.join(", ")}`
              : "ok",
  };
}
