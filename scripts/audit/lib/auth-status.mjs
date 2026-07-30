// A 401/403 error body (e.g. {"error":"Unauthorized"}) still parses as valid
// JSON, so a naive "retry only if JSON.parse failed" check silently accepts it
// as real payload data — every downstream field then reads back `undefined`
// and gets misreported as a data-correctness FAIL rather than an auth hiccup.
// Callers should treat any non-2xx as a signal to re-mint the session token
// and retry instead of trusting the parsed body.
export function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

/** Edge/origin overload or cold-build timeout — safe to retry after backoff. */
export function isTransientOriginError(status) {
  return status === 502 || status === 504 || status === 524;
}
