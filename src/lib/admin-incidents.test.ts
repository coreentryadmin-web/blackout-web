import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIncidentsToResolve, computeMttaMs } from "./admin-incidents";

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
