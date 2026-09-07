/**
 * Pure helpers for scripts/rth-open-check.mjs — when to run trading-session gates.
 * On NYSE full-day closures there is no RTH open; socket/writer freshness checks are false RED.
 */

/** @returns {boolean} false on NYSE holidays — skip socket + writer gates after validate:deploy */
export function shouldRunRthSessionChecks(tradingDay) {
  return tradingDay;
}
