/** After fetchRetry exhausts retries — record as transport SKIP, never crash the sweep. */
export function liveResultFromFetchError(err, ms = 0) {
  const code = err?.cause?.code ?? err?.code;
  const detail =
    (code && String(code)) ||
    String(err?.message ?? err).slice(0, 120).trim() ||
    "fetch_failed";
  return { status: 0, answer: "", transport_error: detail, ms };
}

export function transportSkipIssues(res) {
  if (res.transport_error) {
    return [`fetch-${res.transport_error} — transport, excluded from the quality tally`];
  }
  return [`http-${res.status} — transport, excluded from the quality tally`];
}
