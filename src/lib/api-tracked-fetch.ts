import {
  recordApiCall,
  type ApiCallEvent,
  type ApiProviderId,
} from "@/lib/api-telemetry";
import {
  sanitizeTrackedFetchUrl as sanitizeUrl,
  sanitizeHeaderNames,
  sanitizeTelemetrySnippet,
} from "@/lib/api-telemetry-sanitize";

export type TrackedFetchOptions = RequestInit & {
  maxRetries?: number;
  retryDelayMs?: number;
  correlationId?: string;
  /** Overrides DEFAULT_FETCH_TIMEOUT_MS — mainly for tests exercising the timeout path fast. */
  timeoutMs?: number;
  /**
   * Ms the caller spent waiting for shared-rate-limiter admission BEFORE calling
   * trackedFetch — e.g. uw-rate-limiter.ts's `acquireSlot()` result, threaded through
   * unusual-whales.ts's uwGet. Purely a pass-through for telemetry (see
   * ApiCallEvent.queue_wait_ms); trackedFetch does no queueing itself. Optional —
   * omitting it (every caller today) changes nothing.
   */
  queueWaitMs?: number | null;
  /**
   * Caller-supplied reason this call is being aborted (see ApiCallEvent.cancel_reason).
   * Optional — when omitted, an AbortError is still recorded but with a generic
   * "default_fetch_timeout" reason rather than a caller-specific one.
   */
  cancelReason?: string | null;
};

function headerNames(init?: RequestInit): string[] {
  if (!init?.headers) return [];
  const h = init.headers;
  if (h instanceof Headers) return Array.from(h.keys());
  if (Array.isArray(h)) return h.map(([k]) => k);
  return Object.keys(h);
}

function requestBodyHint(url: string, init?: RequestInit): string | null {
  try {
    const u = new URL(url);
    const qs = u.searchParams.toString();
    let body: string | null = null;
    if (init?.body) {
      body =
        typeof init.body === "string"
          ? init.body.slice(0, 400)
          : "[non-string body]";
    }
    if (qs && body) return `?${qs} | body: ${body}`;
    if (qs) return `?${qs}`;
    return body;
  } catch {
    return null;
  }
}

async function readSnippet(res: Response): Promise<string | null> {
  try {
    const clone = res.clone();
    const text = await clone.text();
    return sanitizeTelemetrySnippet(text.slice(0, 600));
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One structured line per attempt, ONLY when the caller passed queue-timing
 * (today: only uw-rate-limiter.ts's callers) — a plain Polygon/Benzinga call
 * with no queueing concept never emits this, so it adds no log volume for
 * providers this instrumentation isn't about. Read `[api-queue-timing]` lines
 * from CloudWatch to see queue-wait vs. HTTP-execution vs. total elapsed
 * broken out per request, joined by `correlation_id` across retries.
 */
function logQueueTiming(fields: {
  provider: ApiProviderId;
  endpoint: string;
  correlationId: string;
  attempt: number;
  queueEnterAt: number | null;
  queueAdmitAt: number | null;
  queueWaitMs: number | null;
  httpStartAt: number;
  httpEndAt: number;
  httpDurationMs: number;
  status: number | null;
  cancelReason: string | null;
}): void {
  if (fields.queueWaitMs == null) return; // no queue-timing context supplied — nothing to report
  const totalElapsedMs =
    (fields.queueWaitMs ?? 0) + fields.httpDurationMs;
  console.info(
    `[api-queue-timing] provider=${fields.provider} endpoint=${fields.endpoint} ` +
      `correlation_id=${fields.correlationId} attempt=${fields.attempt} ` +
      `queue_enter=${fields.queueEnterAt ?? "-"} queue_admit=${fields.queueAdmitAt ?? "-"} ` +
      `queue_wait_ms=${fields.queueWaitMs ?? "-"} http_start=${fields.httpStartAt} ` +
      `http_end=${fields.httpEndAt} http_duration_ms=${fields.httpDurationMs} ` +
      `status=${fields.status ?? "-"} cancel_reason=${fields.cancelReason ?? "-"} ` +
      `total_elapsed_ms=${totalElapsedMs}`
  );
}

// Bare `fetch()` has no default timeout — a stalled upstream TCP connection (seen live
// against api.massive.com during Polygon GEX-heatmap slowness) hangs the calling request
// indefinitely instead of failing. None of trackedFetch's callers pass their own `signal`,
// so every one of them inherited that hang. 15s is generous versus the ~1-3s p99 for these
// APIs but well under Vercel/Next's own route timeout, so it fails fast without clipping
// legitimately slow-but-healthy responses.
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

// SSRF hardening (request-forgery): `trackedFetch` is the single network-egress choke
// point for every external provider this app calls (Polygon, Unusual Whales, web search,
// the internal blackout_engine, admin health probes). Every caller builds its URL from a
// fixed base plus a caller-supplied ticker/path fragment; per-fragment sanitizers
// (safeTicker/resolveOptionsRoot/etc. — see FINDINGS.md) close the injection at each of
// those call sites, but a future caller could still add a new, unsanitized one. Validating
// the ACTUAL DESTINATION HOST here, once, against a fixed allowlist built ONLY from
// trusted server config (env vars / hardcoded provider hostnames — never from the request
// itself) closes the whole bug class at the one place every flow must pass through: no
// caller can ever reach an unexpected host, regardless of how its path/ticker was built.
function hostnameOf(urlOrBase: string | undefined): string | null {
  if (!urlOrBase) return null;
  try {
    return new URL(urlOrBase).hostname;
  } catch {
    return null;
  }
}

const ALLOWED_FETCH_HOSTS = new Set(
  [
    hostnameOf(process.env.POLYGON_API_BASE) ?? "api.massive.com",
    hostnameOf(process.env.UW_API_BASE) ?? "api.unusualwhales.com",
    // Internal engine base is fully environment-configured (no safe hardcoded default —
    // it varies per deploy), so only allow it when actually set.
    hostnameOf(process.env.API_BASE),
    "api.tavily.com",
    "google.serper.dev",
    "api.search.brave.com",
  ].filter((h): h is string => Boolean(h))
);

/** Test-only escape hatch for local ephemeral test servers (e.g. 127.0.0.1:<random port>
 *  in api-tracked-fetch.test.ts). Never call this from application code — allowlisting a
 *  host here is exactly the control this file exists to enforce everywhere else. */
export function __allowFetchHostForTest(host: string): void {
  ALLOWED_FETCH_HOSTS.add(host);
}

export async function trackedFetch(
  provider: ApiProviderId,
  endpointKey: string,
  url: string,
  init?: TrackedFetchOptions
): Promise<Response> {
  const { maxRetries, retryDelayMs, correlationId, timeoutMs, queueWaitMs, cancelReason, ...fetchInit } = init ?? {};
  const method = (fetchInit.method ?? "GET").toUpperCase();
  const maxAttempts = Math.max(1, (maxRetries ?? 0) + 1);
  const delayMs = retryDelayMs ?? 2000;
  const corrId = correlationId ?? `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeUrl = sanitizeUrl(url);
  // Strip credential headers (Authorization, X-Blackout-Key, etc.) so they are
  // never persisted in the telemetry DB or SSE stream.
  const headersSent = sanitizeHeaderNames(headerNames(fetchInit));
  // Use the sanitized URL when building the body hint so API keys in the query string
  // are scrubbed BEFORE the hint is stored in the telemetry ring buffer.
  const requestBody = requestBodyHint(safeUrl, fetchInit);

  // Reject before ever calling fetch() if the destination isn't one of this app's known
  // providers — see ALLOWED_FETCH_HOSTS above. Not caught by the retry loop below: an
  // unexpected host is a configuration/injection problem, never a transient failure.
  const destHost = hostnameOf(url);
  if (!destHost || !ALLOWED_FETCH_HOSTS.has(destHost)) {
    // Report the SANITIZED url, never the raw one. This branch fires precisely when the URL could
    // not be parsed into a hostname — which is what an unresolved `${{shared.*}}` base placeholder
    // produces ("POLYGON_API_BASE/benzinga/v1/earnings?...&apiKey=<real key>") — so the raw
    // fallback put a live provider key into the thrown message, and from there into every log that
    // catches it, CI output included. Observed twice on 2026-08-17. `safeUrl` is already computed
    // above for exactly this reason and its regex fallback handles the unparseable case.
    throw new Error(`trackedFetch: refusing to fetch disallowed host "${destHost ?? safeUrl}"`);
  }

  let lastEvent: ApiCallEvent | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = Date.now();
    // Fresh per attempt — an AbortSignal.timeout() fires once and can't be reused across
    // retries. Combine with any caller-supplied signal (via AbortSignal.any) so an explicit
    // caller cancellation/timeout still takes effect; otherwise the default is the only bound.
    const timeoutSignal = AbortSignal.timeout(timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const signal = fetchInit.signal
      ? AbortSignal.any([fetchInit.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const res = await fetch(url, { ...fetchInit, signal });
      const end = Date.now();
      const latency_ms = end - start;
      const snippet = res.ok ? null : await readSnippet(res);
      const rateLimited = res.status === 429;

      lastEvent = recordApiCall({
        provider,
        endpoint: endpointKey,
        method,
        status: res.status,
        ok: res.ok,
        latency_ms,
        error: res.ok ? null : snippet?.slice(0, 200) ?? `HTTP ${res.status}`,
        correlation_id: corrId,
        attempt,
        max_attempts: maxAttempts,
        phase: attempt > 1 ? (res.ok ? "success" : "retry") : res.ok ? "success" : "failure",
        request_url: safeUrl,
        request_body: requestBody,
        response_snippet: snippet,
        rate_limited: rateLimited,
        headers_sent: headersSent,
        queue_wait_ms: queueWaitMs ?? null,
        cancel_reason: null,
      });
      logQueueTiming({
        provider,
        endpoint: endpointKey,
        correlationId: corrId,
        attempt,
        queueEnterAt: queueWaitMs != null ? start - queueWaitMs : null,
        queueAdmitAt: queueWaitMs != null ? start : null,
        queueWaitMs: queueWaitMs ?? null,
        httpStartAt: start,
        httpEndAt: end,
        httpDurationMs: latency_ms,
        status: res.status,
        cancelReason: null,
      });

      if (res.ok || attempt >= maxAttempts) return res;

      if (rateLimited || res.status >= 500) {
        await sleep(delayMs * attempt);
        continue;
      }

      return res;
    } catch (err) {
      const end = Date.now();
      const latency_ms = end - start;
      const message = err instanceof Error ? err.message : "Network error";
      // AbortSignal.timeout() (trackedFetch's own internal deadline) rejects with a
      // TimeoutError DOMException; an explicit caller-driven controller.abort() rejects
      // with AbortError (or whatever reason.name the caller's DOMException carries) —
      // both are "this request was cancelled, not a real network/HTTP failure".
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      // Today nothing passes fetchInit.signal or cancelReason, so this branch is only
      // ever reached via trackedFetch's OWN internal AbortSignal.timeout — already-existing
      // behavior, just now labeled instead of collapsing into a generic error string.
      const cancel_reason = isAbort ? (cancelReason ?? "default_fetch_timeout") : null;

      lastEvent = recordApiCall({
        provider,
        endpoint: endpointKey,
        method,
        status: null,
        ok: false,
        latency_ms,
        error: message,
        correlation_id: corrId,
        attempt,
        max_attempts: maxAttempts,
        phase: attempt > 1 ? "retry" : "failure",
        request_url: safeUrl,
        request_body: requestBody,
        response_snippet: null,
        rate_limited: false,
        headers_sent: headersSent,
        queue_wait_ms: queueWaitMs ?? null,
        cancel_reason,
      });
      logQueueTiming({
        provider,
        endpoint: endpointKey,
        correlationId: corrId,
        attempt,
        queueEnterAt: queueWaitMs != null ? start - queueWaitMs : null,
        queueAdmitAt: queueWaitMs != null ? start : null,
        queueWaitMs: queueWaitMs ?? null,
        httpStartAt: start,
        httpEndAt: end,
        httpDurationMs: latency_ms,
        status: null,
        cancelReason: cancel_reason,
      });

      if (attempt >= maxAttempts) throw err;
      await sleep(delayMs * attempt);
    }
  }

  throw new Error(lastEvent?.error ?? "Request failed");
}
