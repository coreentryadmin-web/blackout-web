import { test } from "node:test";
import assert from "node:assert/strict";
import { rthWriterOverdue } from "./rth-warm-leader-logic";

const now = Date.parse("2026-07-02T15:00:00.000Z");

test("rthWriterOverdue: desk-warm overdue after 100s (90s heal threshold)", () => {
  const last = new Date(now - 100_000).toISOString();
  assert.equal(rthWriterOverdue("desk-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: desk-warm fresh at 80s", () => {
  const last = new Date(now - 80_000).toISOString();
  assert.equal(rthWriterOverdue("desk-warm", last, "ok", null, now), false);
});

test("rthWriterOverdue: flow-ingest skipped for alternate writer is not overdue", () => {
  const last = new Date(now - 30 * 60_000).toISOString();
  assert.equal(
    rthWriterOverdue("flow-ingest", last, "skipped", "ws_active_cluster", now),
    false
  );
});

test("rthWriterOverdue: heatmap-warm overdue after 25s (20s heal threshold)", () => {
  const last = new Date(now - 25_000).toISOString();
  assert.equal(rthWriterOverdue("heatmap-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: heatmap-warm fresh at 10s", () => {
  const last = new Date(now - 10_000).toISOString();
  assert.equal(rthWriterOverdue("heatmap-warm", last, "ok", null, now), false);
});

test("rthWriterOverdue: vector-walls-warm overdue after 25s (20s heal threshold)", () => {
  const last = new Date(now - 25_000).toISOString();
  assert.equal(rthWriterOverdue("vector-walls-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: vector-walls-warm fresh at 10s", () => {
  const last = new Date(now - 10_000).toISOString();
  assert.equal(rthWriterOverdue("vector-walls-warm", last, "ok", null, now), false);
});

test("rthWriterOverdue: meridian-warm overdue after 6 min (5 min heal threshold)", () => {
  const last = new Date(now - 6 * 60_000).toISOString();
  assert.equal(rthWriterOverdue("meridian-warm", last, "ok", null, now), true);
});

test("rthWriterOverdue: meridian-warm fresh at 4 min", () => {
  const last = new Date(now - 4 * 60_000).toISOString();
  assert.equal(rthWriterOverdue("meridian-warm", last, "ok", null, now), false);
});

test("rthWriterOverdue: vector-pick-sweep overdue with no prior run", () => {
  assert.equal(rthWriterOverdue("vector-pick-sweep", null, null, null, now), true);
});

test("rthWriterOverdue: vector-pick-sweep overdue after 5 min (4 min heal threshold)", () => {
  const last = new Date(now - 5 * 60_000).toISOString();
  assert.equal(rthWriterOverdue("vector-pick-sweep", last, "ok", null, now), true);
});

test("rthWriterOverdue: vector-pick-sweep fresh at 3 min", () => {
  const last = new Date(now - 3 * 60_000).toISOString();
  assert.equal(rthWriterOverdue("vector-pick-sweep", last, "ok", null, now), false);
});

test("rthWriterOverdue: unknown key never overdue", () => {
  assert.equal(rthWriterOverdue("db-cleanup", null, null, null, now), false);
});
