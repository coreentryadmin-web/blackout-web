import { test } from "node:test";
import assert from "node:assert/strict";
import { sortMemberships } from "./membership-sort";

test("different statuses sort by priority regardless of created_at", () => {
  const arr = [
    { status: "completed", created_at: "2026-06-01T00:00:00Z" },
    { status: "active", created_at: "2026-01-01T00:00:00Z" },
  ] as Parameters<typeof sortMemberships>[0];
  const sorted = sortMemberships(arr);
  assert.equal(sorted[0]?.status, "active");
});

test("same status sorts most-recent created_at first", () => {
  const arr = [
    { status: "active", created_at: "2026-01-01T00:00:00Z" },
    { status: "active", created_at: "2026-06-01T00:00:00Z" },
  ] as Parameters<typeof sortMemberships>[0];
  const sorted = sortMemberships(arr);
  assert.equal(sorted[0]?.created_at, "2026-06-01T00:00:00Z");
});

test("missing/garbage created_at coerces to 0, no NaN/throw", () => {
  const arr = [
    { status: "active" },
    { status: "active", created_at: "not-a-date" },
    { status: "active", created_at: "2026-06-01T00:00:00Z" },
  ] as Parameters<typeof sortMemberships>[0];
  assert.doesNotThrow(() => sortMemberships(arr));
  const sorted = sortMemberships(arr);
  assert.equal(sorted[0]?.created_at, "2026-06-01T00:00:00Z");
});
