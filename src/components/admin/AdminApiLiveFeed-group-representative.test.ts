import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiCallEvent } from "@/lib/api-telemetry-types";
import { incidentDedupeKey } from "@/lib/api-telemetry-types";
import { groupErrors, pushGrouped } from "./AdminApiLiveFeed";

/**
 * Regression (DISCOVERY sweep, round 239). `groupErrors` folds a BATCH of events through
 * `pushGrouped` via `Array.reduce`, which visits `events[0]` first and `events[events.length-1]`
 * last. The server's `recent_errors`/`recent_events` snapshot (api-telemetry.ts's
 * `getApiTelemetrySnapshot`, itself built from `events.unshift(event)`) is always NEWEST-FIRST.
 *
 * `pushGrouped`'s old logic always made the group's representative `event` whatever was just
 * passed in, with no comparison against the group's existing one. For a repeated incident key
 * appearing twice in a newest-first batch, that meant the SECOND time it was folded in — which,
 * because the batch is newest-first, is chronologically the OLDER occurrence — overwrote the
 * group's `event` field with the older one's data. The feed would then show the older error's
 * text/severity/attempt count and `timeAgoFromIso` would understate how recently the incident
 * actually last fired, while still being bumped to the front of the list looking "fresh".
 *
 * The fix compares `seq_id` (strictly increasing, immune to fold order) and always keeps the
 * NEWER of the two events as the group's representative, regardless of which order
 * `pushGrouped` is called in.
 */

function ev(over: Partial<ApiCallEvent>): ApiCallEvent {
  return {
    id: over.id ?? "id",
    seq_id: over.seq_id ?? 1,
    correlation_id: "corr",
    provider: "polygon",
    endpoint: "/v2/agg",
    method: "GET",
    status: 500,
    ok: false,
    latency_ms: 100,
    error: "boom",
    at: over.at ?? "2026-11-01T00:00:00.000Z",
    attempt: 1,
    max_attempts: 3,
    retry_status: "none",
    phase: "failure",
    request_url: "https://example.test",
    request_body: null,
    response_snippet: null,
    rate_limited: false,
    headers_sent: [],
    severity: "p1",
    sla_breach: false,
    ...over,
  };
}

test("groupErrors: folding a NEWEST-FIRST batch keeps the NEWER occurrence as the group's representative event", () => {
  // Newest-first batch (matches the real server snapshot order): e_new (seq 3) is the most
  // recent occurrence of key A, e_old (seq 1) is an earlier occurrence of the SAME key A.
  const e_new = ev({ id: "new", seq_id: 3, error: "fresh error text", at: "2026-11-01T00:00:03.000Z" });
  const e_mid = ev({ id: "mid", seq_id: 2, provider: "unusual_whales", error: "other incident" });
  const e_old = ev({ id: "old", seq_id: 1, error: "stale error text", at: "2026-11-01T00:00:01.000Z" });

  const groups = groupErrors([e_new, e_mid, e_old]);

  const groupA = groups.find((g) => g.event.id === "new" || g.event.id === "old");
  assert.ok(groupA, "the two same-key events must have merged into one group");
  assert.equal(groupA.count, 2, "both occurrences must be counted");
  assert.equal(
    groupA.event.id,
    "new",
    "the group must display the NEWER occurrence (highest seq_id), not whichever was folded in last"
  );
  assert.equal(groupA.event.error, "fresh error text");
});

test("pushGrouped: a single live SSE push (always the newest) still becomes the representative", () => {
  // Live single-event path: incoming event is always newer than anything already grouped.
  const existingEvent = ev({ id: "older", seq_id: 5 });
  const existing = [{ key: incidentDedupeKey(existingEvent), event: existingEvent, count: 1 }];
  const incoming = ev({ id: "newer", seq_id: 6 });
  const next = pushGrouped(existing, incoming);
  assert.equal(next[0].event.id, "newer");
  assert.equal(next[0].count, 2);
});

test("pushGrouped: an out-of-order call with an OLDER seq_id never regresses an already-newer representative", () => {
  const existingEvent = ev({ id: "newer", seq_id: 10 });
  const existing = [{ key: incidentDedupeKey(existingEvent), event: existingEvent, count: 1 }];
  const olderArrival = ev({ id: "older", seq_id: 4 });
  const next = pushGrouped(existing, olderArrival);
  assert.equal(
    next[0].event.id,
    "newer",
    "an older event folded in after a newer one must not overwrite the representative"
  );
  assert.equal(next[0].count, 2, "the count still increments even though the representative is unchanged");
});
