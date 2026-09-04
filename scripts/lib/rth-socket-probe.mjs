/**
 * Pure helpers for RTH-open options-socket probe retries.
 * A transient "marks warming" response on attempt 1 must not fail the run when attempt 2 is green.
 */

/** @typedef {{ ok: boolean, detail?: string }} SocketHealthOptions */

/**
 * @param {SocketHealthOptions | null | undefined} opt
 * @param {boolean} afterMarketOpen930
 * @returns {"pass" | "retry" | "fail"}
 */
export function socketProbeAttemptVerdict(opt, afterMarketOpen930) {
  if (!opt) return "retry";
  if (opt.ok) return "pass";
  if (!afterMarketOpen930) return "pass"; // pre-09:30 is warn-only in the harness
  return "retry";
}

/**
 * @param {boolean} socketProbeOk
 * @param {string | null} lastDetail
 * @param {boolean} afterMarketOpen930
 * @returns {string | null} failure message, or null when the probe should pass
 */
export function socketProbeFinalFailure(socketProbeOk, lastDetail, afterMarketOpen930) {
  if (socketProbeOk) return null;
  if (!afterMarketOpen930) return null;
  if (!lastDetail) return "options-socket probe did not return options health";
  return `options-socket: ${lastDetail}`;
}
