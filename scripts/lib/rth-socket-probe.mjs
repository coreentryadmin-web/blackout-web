/**
 * Pure helpers for RTH-open options-socket probe retries.
 * A transient "marks warming" response on attempt 1 must not fail the run when attempt 2 is green.
 */

/** @typedef {{ ok: boolean, detail?: string }} SocketHealthOptions */

/** NYSE holiday / non-trading day — socket-health returns ok+skipped without websockets (#4517). */
export function isSocketHealthSkipped(body) {
  return body?.ok === true && body?.skipped === true;
}

/** Latest cron_job_runs.status values that mean the job did its job (not a fault). */
export function isCronRunHealthyStatus(status) {
  return status === "ok" || status === "skipped";
}

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

/**
 * Retry socket-health until options marks are fresh or attempts exhaust.
 * Mirrors rth-open-check.mjs so validate:deploy does not warn on transient 503/warming.
 *
 * @param {{
 *   fetchSocketHealth: () => Promise<{ status: number, body: Record<string, unknown> }>,
 *   afterOpen930: boolean,
 *   maxAttempts?: number,
 *   onRetry?: (attempt: number, detail: string) => void,
 * }} opts
 * @returns {{ ok: boolean, detail: string | null, successDetail: string | null, failure: string | null, preOpenWarn: string | null }}
 */
export async function probeOptionsSocketWithRetries({
  fetchSocketHealth,
  afterOpen930,
  maxAttempts = 3,
  onRetry,
}) {
  let socketProbeOk = false;
  let socketLastDetail = null;
  let preOpenWarn = null;
  let successDetail = null;

  for (let attempt = 0; attempt < maxAttempts && !socketProbeOk; attempt++) {
    try {
      const { status, body } = await fetchSocketHealth();
      const opt = body?.websockets?.options;
      if (opt) {
        const verdict = socketProbeAttemptVerdict(opt, afterOpen930);
        if (verdict === "pass") {
          if (!opt.ok && !afterOpen930) {
            preOpenWarn = opt.detail ?? "warming";
          } else if (opt.detail) {
            successDetail = opt.detail;
          }
          socketProbeOk = true;
        } else {
          socketLastDetail = opt.detail ?? socketLastDetail;
          if (attempt < maxAttempts - 1) {
            onRetry?.(attempt + 1, opt.detail ?? "warming");
          }
        }
      } else if (isSocketHealthSkipped(body)) {
        socketProbeOk = true;
        successDetail =
          typeof body.reason === "string" ? body.reason : "non-trading day (socket-health skipped)";
      } else if (status === 401) {
        socketProbeOk = true;
        preOpenWarn = "CRON_SECRET in this env may not match prod";
      } else {
        socketLastDetail = `probe HTTP ${status}`;
        if (attempt < maxAttempts - 1) {
          onRetry?.(attempt + 1, `HTTP ${status}`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      socketLastDetail = message;
      if (attempt < maxAttempts - 1) {
        onRetry?.(attempt + 1, message);
      }
    }
  }

  return {
    ok: socketProbeOk,
    detail: socketLastDetail,
    successDetail,
    failure: socketProbeFinalFailure(socketProbeOk, socketLastDetail, afterOpen930),
    preOpenWarn,
  };
}
