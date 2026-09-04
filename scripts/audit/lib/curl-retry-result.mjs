/** True when a curl harness result should backoff and retry (TLS reset, edge 5xx, no status). */
export function isRetryableCurlResult(r) {
  if (r.err && /reset|timed out|connection|ECONN|Recv failure/i.test(r.err)) return true;
  if (!r.s) return true;
  return r.s === 502 || r.s === 503 || r.s === 504 || r.s === 524;
}

/** Deploy-smoke gate: auth-only failures are AMBER — public SEO checks already passed. */
export function seoAuditExitCode(fails) {
  if (!fails.length) return 0;
  const authOnlyFail = fails.every((c) => c.name === "auth");
  return authOnlyFail ? 0 : 1;
}
