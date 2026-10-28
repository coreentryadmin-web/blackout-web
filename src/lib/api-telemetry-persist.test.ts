import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import type { ApiCallEvent } from "@/lib/api-telemetry-types";

// api-telemetry-persist.ts (the module under test) has a top-level `import "server-only"`,
// which throws unconditionally outside a Server Component bundle — same stub every other
// server-only module's test file already uses (e.g. src/lib/largo/product-reads.test.ts).
mock.module("server-only", { namedExports: {} });

// api-telemetry-persist.ts (the module under test) statically imports @/lib/db — mocked
// here the same way src/lib/admin-gex-health.test.ts etc. mock "./db" from this directory.
//
// RED→GREEN regression for: "Phase 1 instrumentation" (queue_wait_ms/cancel_reason on
// ApiCallEvent, added so UW/Anthropic rate-limiter queue-wait and timeout-cancel reasons
// could be diagnosed — see api-telemetry-types.ts's doc comments and
// api-telemetry.test.ts's own "Phase 1 instrumentation" tests) was wired all the way from
// api-tracked-fetch.ts's callers into the live in-memory ApiCallEvent (recordApiCall), but
// persistApiTelemetryEvent's INSERT never carried either column and fetchPersistedApiEvent
// never read them back — so a persisted row (the ONLY copy left once an event ages out of
// the 800-entry in-memory ring buffer, which fills fast across 5 ECS replicas) silently
// lost both fields. An admin viewing a historical event detail
// (src/app/api/admin/apis/events/[id]/route.ts, which falls back to
// fetchPersistedApiEvent once buildEventDetail's in-memory lookup misses) would see
// `cancel_reason: null` / a missing `queue_wait_ms` even though the live call genuinely
// captured both.

const state = {
  dbConfigured: true,
  insertedParams: null as unknown[] | null,
  selectRow: null as Record<string, unknown> | null,
};

function resetState() {
  state.dbConfigured = true;
  state.insertedParams = null;
  state.selectRow = null;
}

mock.module("./db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async (text: string, values?: unknown[]) => {
      if (/^\s*INSERT INTO api_telemetry_events/.test(text)) {
        state.insertedParams = values ?? [];
        return { rows: [], rowCount: 0 };
      }
      if (/^\s*SELECT \* FROM api_telemetry_events/.test(text)) {
        return { rows: state.selectRow ? [state.selectRow] : [], rowCount: state.selectRow ? 1 : 0 };
      }
      throw new Error(`unexpected query in test: ${text}`);
    },
  },
});

let persistApiTelemetryEvent: typeof import("./api-telemetry-persist").persistApiTelemetryEvent;
let fetchPersistedApiEvent: typeof import("./api-telemetry-persist").fetchPersistedApiEvent;

before(async () => {
  ({ persistApiTelemetryEvent, fetchPersistedApiEvent } = await import("./api-telemetry-persist"));
});

function fakeEvent(overrides: Partial<ApiCallEvent> = {}): ApiCallEvent {
  return {
    id: "evt-1",
    seq_id: 1,
    correlation_id: "corr-1",
    provider: "unusual_whales",
    endpoint: "/api/darkpool/AAPL",
    method: "GET",
    status: null,
    ok: false,
    latency_ms: 15000,
    error: "aborted",
    at: "2026-10-26T14:00:00.000Z",
    attempt: 1,
    max_attempts: 1,
    retry_status: "exhausted",
    phase: "failure",
    request_url: "/api/darkpool/AAPL",
    request_body: null,
    response_snippet: null,
    rate_limited: false,
    headers_sent: [],
    severity: "p2",
    sla_breach: false,
    queue_wait_ms: 18234,
    cancel_reason: "dossier_ticker_wall_timeout",
    ...overrides,
  };
}

test("persistApiTelemetryEvent: carries queue_wait_ms/cancel_reason into the INSERT params (was silently dropped pre-fix)", async () => {
  resetState();
  await persistApiTelemetryEvent(fakeEvent());
  assert.ok(state.insertedParams, "INSERT was not executed");
  // Column order matches the INSERT's own column list — the two new columns are appended
  // last (queue_wait_ms, cancel_reason), per persistApiTelemetryEvent's own SQL text.
  const params = state.insertedParams!;
  assert.equal(params[params.length - 2], 18234, "queue_wait_ms must reach the INSERT");
  assert.equal(
    params[params.length - 1],
    "dossier_ticker_wall_timeout",
    "cancel_reason must reach the INSERT"
  );
});

test("persistApiTelemetryEvent: queue_wait_ms/cancel_reason persist as null when the event has no value (never fabricated)", async () => {
  resetState();
  await persistApiTelemetryEvent(fakeEvent({ queue_wait_ms: null, cancel_reason: null }));
  const params = state.insertedParams!;
  assert.equal(params[params.length - 2], null);
  assert.equal(params[params.length - 1], null);
});

test("fetchPersistedApiEvent: round-trips queue_wait_ms/cancel_reason from a persisted row (was lost pre-fix — admin event-detail fallback read null)", async () => {
  resetState();
  state.selectRow = {
    seq_id: "7",
    event_id: "evt-7",
    correlation_id: "corr-7",
    provider: "unusual_whales",
    endpoint: "/api/darkpool/AAPL",
    method: "GET",
    status: null,
    ok: false,
    latency_ms: 15000,
    error: "aborted",
    severity: "p2",
    rate_limited: false,
    sla_breach: false,
    attempt: 1,
    max_attempts: 1,
    retry_status: "exhausted",
    phase: "failure",
    request_url: "/api/darkpool/AAPL",
    request_body: null,
    response_snippet: null,
    headers_sent: [],
    at: new Date("2026-10-26T14:00:00.000Z"),
    queue_wait_ms: 18234,
    cancel_reason: "dossier_ticker_wall_timeout",
  };
  const event = await fetchPersistedApiEvent("evt-7");
  assert.ok(event);
  assert.equal(event!.queue_wait_ms, 18234);
  assert.equal(event!.cancel_reason, "dossier_ticker_wall_timeout");
});
