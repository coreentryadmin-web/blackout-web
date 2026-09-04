import { isRetryableFetchError, isRetryableStatus } from "./fetch-retry.mjs";

/** @param {{ s?: number, err?: string }} result */
export function isRetryableCurlResult(result) {
  if (!result) return false;
  if (result.err) {
    const msg = String(result.err);
    if (isRetryableFetchError(new Error(msg))) return true;
    return /connection reset|recv failure|timed out|couldn't connect|empty reply|ssl connect/i.test(msg);
  }
  if (result.s && isRetryableStatus(result.s)) return true;
  return false;
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin — audit harness is short-lived */
  }
}

/**
 * Retry transient curl/exec failures (TLS reset, 5xx) before returning.
 * @param {(opts: object) => { s: number, b: string, err?: string }} curlOnce
 * @param {object} opts
 * @param {{ retries?: number, baseDelayMs?: number }} [retryOpts]
 */
export function curlWithRetry(curlOnce, opts, retryOpts = {}) {
  const retries = retryOpts.retries ?? (Number(process.env.CURL_RETRIES ?? 4) || 4);
  const baseDelayMs = retryOpts.baseDelayMs ?? 1500;
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = curlOnce(opts);
    if (!isRetryableCurlResult(last) || attempt === retries) return last;
    sleepSync(baseDelayMs * (attempt + 1));
  }
  return last;
}
