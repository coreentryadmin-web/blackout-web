import { test } from "node:test";
import assert from "node:assert/strict";

// Pure replica of membership.ts comparator (the inline fix). membership.ts imports
// @clerk/nextjs/server, so this locks the corrected tiebreak logic standalone.
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 1,
  completed: 2,
  past_due: 3,
  canceling: 4,
};

type M = { status: string; created_at?: string };
function compare(a: M, b: M): number {
  const aP = STATUS_PRIORITY[a.status] ?? 99;
  const bP = STATUS_PRIORITY[b.status] ?? 99;
  if (aP !== bP) return aP - bP;
  const aTs = Date.parse(a.created_at ?? "") || 0;
  const bTs = Date.parse(b.created_at ?? "") || 0;
  return bTs - aTs;
}

test("different statuses sort by priority regardless of created_at", () => {
  const arr: M[] = [
    { status: "completed", created_at: "2026-06-01T00:00:00Z" },
    { status: "active", created_at: "2026-01-01T00:00:00Z" },
  ];
  arr.sort(compare);
  assert.equal(arr[0].status, "active");
});

test("same status sorts most-recent created_at first (regression: was NaN)", () => {
  const arr: M[] = [
    { status: "active", created_at: "2026-01-01T00:00:00Z" },
    { status: "active", created_at: "2026-06-01T00:00:00Z" },
  ];
  arr.sort(compare);
  assert.equal(arr[0].created_at, "2026-06-01T00:00:00Z");
});

test("missing/garbage created_at coerces to 0, no NaN/throw", () => {
  const arr: M[] = [
    { status: "active" },
    { status: "active", created_at: "not-a-date" },
    { status: "active", created_at: "2026-06-01T00:00:00Z" },
  ];
  assert.doesNotThrow(() => arr.sort(compare));
  assert.equal(arr[0].created_at, "2026-06-01T00:00:00Z");
});
