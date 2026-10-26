import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIncidentsToResolve, computeMttaMs, nextIncidentLifecycle } from "./admin-incidents";

test("resolves open rows not in the active set when no scope is given", () => {
  const open = [
    { fingerprint: "a:1", category: "spx" },
    { fingerprint: "b:2", category: "spx" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]));
  assert.deepEqual(resolved, ["b:2"]);
});

test("never resolves a fingerprint still in the active set", () => {
  const open = [{ fingerprint: "a:1", category: "spx" }];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]));
  assert.deepEqual(resolved, []);
});

test("resolveScope excludes categories the caller doesn't own", () => {
  const open = [
    { fingerprint: "a:1", category: "data-integrity-freshness" },
    { fingerprint: "b:2", category: "spx-halt" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(), (cat) => !cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, ["b:2"]);
});

test("resolveScope scoped to data-integrity only resolves that namespace", () => {
  const open = [
    { fingerprint: "a:1", category: "data-integrity-freshness" },
    { fingerprint: "b:2", category: "spx-halt" },
  ];
  const resolved = computeIncidentsToResolve(open, new Set(), (cat) => cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, ["a:1"]);
});

test("empty open set resolves nothing", () => {
  assert.deepEqual(computeIncidentsToResolve([], new Set()), []);
});

test("scope AND active-set exclusion combine — a scoped, still-active row is not resolved", () => {
  const open = [{ fingerprint: "a:1", category: "data-integrity-freshness" }];
  const resolved = computeIncidentsToResolve(open, new Set(["a:1"]), (cat) => cat.startsWith("data-integrity"));
  assert.deepEqual(resolved, []);
});

test("computeMttaMs: an acked incident reports the real ack - open delta", () => {
  const opened = 1_000;
  const acked = 46_000;
  assert.equal(computeMttaMs(acked, opened), 45_000);
});

test("computeMttaMs: a still-open, never-acked incident reports null — not elapsed time since open", () => {
  // This is the exact regression this test exists for: it must NEVER fall back to
  // "now - openedAtMs" for an incident that has no acked_at yet, no matter how long
  // it has been open — that would fabricate a "time to acknowledge" for an incident
  // nobody has acknowledged, corrupting the dashboard's "Avg MTTA" aggregate and the
  // per-row "MTTA" badge with an incident's raw age instead of a real measurement.
  const openedLongAgo = Date.now() - 117 * 24 * 60 * 60 * 1000; // 117 days ago
  assert.equal(computeMttaMs(null, openedLongAgo), null);
});

test("computeMttaMs: zero elapsed between open and ack is a real zero, not null", () => {
  assert.equal(computeMttaMs(5_000, 5_000), 0);
});

test("nextIncidentLifecycle: a brand-new fingerprint (no prior row) starts a fresh, unacked lifecycle", () => {
  const now = "2026-10-26T12:00:00.000Z";
  assert.deepEqual(nextIncidentLifecycle(undefined, now), {
    status: "open",
    opened_at: now,
    acked_at: null,
    acked_by: null,
    resolved_at: null,
  });
});

test("nextIncidentLifecycle: a RESOLVED fingerprint reactivating restarts the whole lifecycle — this is the regression", () => {
  const now = "2026-10-26T12:00:00.000Z";
  const prior = {
    status: "resolved" as const,
    acked_at: "2026-10-18T12:00:00.000Z",
    acked_by: "ops@blackout",
    opened_at: "2026-10-18T11:30:00.000Z",
  };
  // Before the fix, only `status`/`resolved_at` were ever reset — acked_at/acked_by/opened_at
  // carried straight over from the PREVIOUS occurrence, so a currently-open, never-(this-time)-
  // acked incident reported a real-looking MTTA. computeMttaMs's own invariant (above) says a
  // still-open, never-acked incident must report null — this is what feeds it that null.
  assert.deepEqual(nextIncidentLifecycle(prior, now), {
    status: "open",
    opened_at: now,
    acked_at: null,
    acked_by: null,
    resolved_at: null,
  });
});

test("nextIncidentLifecycle: a still-OPEN, never-acked fingerprint is left untouched", () => {
  const prior = { status: "open" as const, acked_at: null, acked_by: null, opened_at: "2026-10-01T00:00:00.000Z" };
  assert.deepEqual(nextIncidentLifecycle(prior, "2026-10-26T12:00:00.000Z"), {
    status: "open",
    opened_at: "2026-10-01T00:00:00.000Z",
    acked_at: null,
    acked_by: null,
    resolved_at: null,
  });
});

test("nextIncidentLifecycle: a still-ACKED fingerprint keeps its real ack, not reset and not re-fabricated", () => {
  const prior = {
    status: "acked" as const,
    acked_at: "2026-10-20T10:00:00.000Z",
    acked_by: "ops@blackout",
    opened_at: "2026-10-20T09:00:00.000Z",
  };
  assert.deepEqual(nextIncidentLifecycle(prior, "2026-10-26T12:00:00.000Z"), {
    status: "acked",
    opened_at: "2026-10-20T09:00:00.000Z",
    acked_at: "2026-10-20T10:00:00.000Z",
    acked_by: "ops@blackout",
    resolved_at: null,
  });
});
