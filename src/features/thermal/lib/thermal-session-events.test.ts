import assert from "node:assert/strict";
import test from "node:test";
import {
  eventStrike,
  fmtSessionEventAge,
  sortSessionEventsNewestFirst,
} from "./thermal-session-events.ts";

test("sortSessionEventsNewestFirst orders by at desc", () => {
  const sorted = sortSessionEventsNewestFirst([
    { type: "a", severity: "info", message: "old", at: "2026-09-06T10:00:00.000Z" },
    { type: "b", severity: "info", message: "new", at: "2026-09-06T12:00:00.000Z" },
  ]);
  assert.equal(sorted[0]?.message, "new");
});

test("eventStrike reads level field", () => {
  assert.equal(eventStrike({ type: "x", severity: "info", message: "", at: "", level: 775 }), 775);
});

test("fmtSessionEventAge — just now under one minute", () => {
  const now = Date.parse("2026-09-06T12:00:10.000Z");
  assert.equal(fmtSessionEventAge("2026-09-06T12:00:00.000Z", now), "just now");
});
