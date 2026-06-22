import { test } from "node:test";
import assert from "node:assert/strict";
import { safeTime } from "./safe-time";

// Pure unit tests for the NaN-guarded time parser used by the tape comparators.
// Runnable via `npx tsx --test` — safeTime is alias-free (only the Date global),
// so no Next/server boot is required.

test("valid ISO returns Date.parse of the same string", () => {
  const iso = "2026-06-22T14:30:00Z";
  assert.equal(safeTime(iso), Date.parse(iso));
});

test("epoch returns 0 (via the valid path, not the fallback)", () => {
  assert.equal(safeTime("1970-01-01T00:00:00Z"), 0);
});

test("unparseable string sinks to 0", () => {
  assert.equal(safeTime("not-a-date"), 0);
});

test("empty string sinks to 0", () => {
  assert.equal(safeTime(""), 0);
});

test("null and undefined sink to 0", () => {
  assert.equal(safeTime(null), 0);
  assert.equal(safeTime(undefined), 0);
});

test("valid timestamps preserve byte-identical ordering to new Date().getTime()", () => {
  const a = "2026-06-22T10:00:00Z";
  const b = "2026-06-22T12:00:00Z";
  assert.equal(safeTime(b) - safeTime(a), new Date(b).getTime() - new Date(a).getTime());
});

test("comparator stability: one bad timestamp no longer corrupts ordering", () => {
  // With the OLD comparator (new Date(t).getTime()) the 'bad' entry produces NaN
  // and poisons the descending sort. safeTime sinks it to 0 (oldest), so the three
  // valid prints stay in strict descending order and the bad one falls to the end.
  const items = [
    { time: "2026-06-22T10:00:00Z" },
    { time: "bad" },
    { time: "2026-06-22T12:00:00Z" },
    { time: "2026-06-22T11:00:00Z" },
  ];
  const sorted = [...items].sort((a, b) => safeTime(b.time) - safeTime(a.time));
  assert.deepEqual(
    sorted.map((i) => i.time),
    ["2026-06-22T12:00:00Z", "2026-06-22T11:00:00Z", "2026-06-22T10:00:00Z", "bad"]
  );
});
