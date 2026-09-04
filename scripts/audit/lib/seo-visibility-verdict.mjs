/**
 * Verdict + exit policy for seo-visibility-audit.mjs.
 * Public SEO checks are the deploy-smoke gate; authed Clerk mint is best-effort (AMBER on flake).
 */

/** @typedef {{ name: string, status: string, detail?: string }} SeoCheck */

/**
 * @param {SeoCheck[]} checks
 * @returns {"GREEN" | "AMBER" | "RED"}
 */
export function seoVisibilityVerdict(checks) {
  const fails = checks.filter((c) => c.status === "FAIL");
  if (fails.length === 0) return "GREEN";
  if (fails.every((c) => c.name === "auth")) return "AMBER";
  return "RED";
}

/**
 * @param {SeoCheck[]} checks
 * @returns {0 | 1}
 */
export function seoVisibilityExitCode(checks) {
  return seoVisibilityVerdict(checks) === "RED" ? 1 : 0;
}

/**
 * @param {{ s?: number, err?: string }} curlResult
 */
export function isTransientCurlFailure(curlResult) {
  if (curlResult?.s && curlResult.s >= 200 && curlResult.s < 500) return false;
  const msg = String(curlResult?.err ?? "");
  return (
    curlResult?.s === 0 ||
    /connection reset|recv failure|timed out|ECONNRESET|ETIMEDOUT/i.test(msg)
  );
}
