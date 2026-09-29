export type ApiProviderId =
  | "polygon"
  | "unusual_whales"
  | "anthropic"
  | "blackout_engine"
  | "postgres"
  | "web_search";

export type ApiCallPhase = "attempt" | "retry" | "success" | "failure";
export type ApiRetryStatus = "none" | "scheduled" | "in_progress" | "exhausted" | "recovered";
export type ApiIncidentSeverity = "p1" | "p2" | "p3" | "ok";

export type ApiCallEvent = {
  id: string;
  seq_id: number;
  correlation_id: string;
  provider: ApiProviderId;
  endpoint: string;
  method: string;
  status: number | null;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  at: string;
  attempt: number;
  max_attempts: number;
  retry_status: ApiRetryStatus;
  phase: ApiCallPhase;
  request_url: string;
  request_body: string | null;
  response_snippet: string | null;
  rate_limited: boolean;
  headers_sent: string[];
  severity: ApiIncidentSeverity;
  sla_breach: boolean;
  /**
   * True for events that are not real outbound API calls (e.g. an admin GET
   * route catch-block recording a 500). These carry no meaningful latency, so
   * they are excluded from provider latency aggregation (avg/p95/p99) while
   * still surfacing in counts and the incident/error feeds.
   */
  synthetic?: boolean;
  /**
   * Milliseconds spent waiting for shared-rate-limiter admission BEFORE the
   * network request in `latency_ms` began — e.g. uw-rate-limiter.ts's
   * `acquireSlot()` result. `latency_ms` already measures only the actual
   * `fetch()` call (trackedFetch starts its clock after admission), so this
   * field is additive instrumentation, not a redefinition of an existing one:
   * total elapsed for the caller is `(queue_wait_ms ?? 0) + latency_ms`.
   * `null`/`undefined` for callers with no shared-limiter concept (most
   * providers) — never fabricated as 0 to mean "measured and found zero".
   */
  queue_wait_ms?: number | null;
  /**
   * Why a request was aborted/cancelled, when it was — e.g.
   * "dossier_ticker_wall_timeout", "dossier_fetch_local_timeout",
   * "default_fetch_timeout" (trackedFetch's own internal AbortSignal.timeout
   * firing with no caller-supplied reason). `null` for a call that completed
   * (successfully or with a real HTTP error) without ever being cancelled.
   */
  cancel_reason?: string | null;
};

export type ApiEndpointStats = {
  endpoint: string;
  method: string;
  call_count: number;
  error_count: number;
  last_status: number | null;
  last_latency_ms: number | null;
  last_ok: boolean;
  last_at: string | null;
  last_error: string | null;
  avg_latency_ms: number;
  latency_samples: number[];
  p95_latency_ms: number;
  p99_latency_ms: number;
};

export type ProviderHealthRow = {
  calls_5m: number;
  errors_5m: number;
  rate_limits_5m: number;
  last_at: string | null;
  last_status: number | null;
  last_ok: boolean;
  last_error: string | null;
  last_endpoint: string | null;
};

export function classifyEventSeverity(input: {
  ok: boolean;
  status: number | null;
  rate_limited: boolean;
}): ApiIncidentSeverity {
  if (input.ok) return "ok";
  if (input.status === null || input.status >= 500) return "p1";
  if (input.rate_limited || input.status === 429) return "p2";
  return "p3";
}

export function incidentDedupeKey(event: ApiCallEvent): string {
  const statusKey = event.sla_breach ? "sla" : String(event.status ?? "null");
  return `${event.provider}|${event.endpoint}|${statusKey}|${event.severity}`;
}

export function isFeedableIncident(event: ApiCallEvent): boolean {
  return !event.ok || event.sla_breach;
}
