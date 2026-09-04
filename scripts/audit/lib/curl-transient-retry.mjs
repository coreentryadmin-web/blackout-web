/**
 * Retry curl-backed FAPI calls when GitHub Actions or ECS rollouts hit transient TLS resets.
 * deploy-smoke failed 2026-09-04: `curl: (35) Recv failure: Connection reset by peer` during
 * Clerk ticket → JWT exchange in seo-visibility-audit.mjs while HTTP smoke was GREEN.
 */

/** @param {{ s?: number, err?: string } | null | undefined} r */
export function isTransientCurlFailure(r) {
  if (!r || (typeof r.s === "number" && r.s > 0)) return false;
  const msg = String(r.err || "");
  return (
    r.s === 0 ||
    /connection reset|recv failure|timed out|timeout|could not resolve|tls/i.test(msg)
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {(attempt: number) => T} fn
 * @param {{ attempts?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withTransientRetry(fn, { attempts = 3, baseDelayMs = 1200 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = fn(i);
    if (!isTransientCurlFailure(last) || i === attempts) return last;
    await sleep(baseDelayMs * i);
  }
  return last;
}
