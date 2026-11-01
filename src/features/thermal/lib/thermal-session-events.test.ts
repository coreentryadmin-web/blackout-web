import assert from "node:assert/strict";
import test from "node:test";
import {
  eventStrike,
  fmtSessionEventAge,
  resolveSessionTimelineExpanded,
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

// Regression: the panel mounts with ZERO events most sessions (events fill in through the day —
// see the component's own empty-state copy) and a `useState(() => itemCount > 0 && itemCount <=
// 3)` lazy initializer freezes that read at mount time, so the short-list auto-expand effectively
// never fires for the component's real, documented usage pattern — a count that later lands in the
// 1-3 window after mounting empty stays collapsed forever, and a count that grows past 3 after an
// early short-list auto-expand never auto-collapses either. `resolveSessionTimelineExpanded` must
// be re-derived from the LIVE count on every call instead.
test("resolveSessionTimelineExpanded — no user override: auto-expands only while the live count is short (1-3)", () => {
  assert.equal(resolveSessionTimelineExpanded(0, null), false, "0 events: nothing to expand");
  assert.equal(resolveSessionTimelineExpanded(1, null), true);
  assert.equal(resolveSessionTimelineExpanded(3, null), true);
  assert.equal(resolveSessionTimelineExpanded(4, null), false, "past the short-list window");
});

test("resolveSessionTimelineExpanded — re-derives as the count grows across a session, not just at mount", () => {
  // The exact failure mode this guards: mounting empty (0) must not permanently lock the panel
  // collapsed once real events land inside the short-list window later in the same session.
  assert.equal(resolveSessionTimelineExpanded(0, null), false, "mounts empty — nothing yet");
  assert.equal(
    resolveSessionTimelineExpanded(2, null),
    true,
    "count later lands at 2 (still no user override) — must now read as expanded"
  );
  assert.equal(
    resolveSessionTimelineExpanded(5, null),
    false,
    "count grows past the window (still no override) — must now read as collapsed"
  );
});

test("resolveSessionTimelineExpanded — a user override always wins over the live count", () => {
  assert.equal(resolveSessionTimelineExpanded(1, false), false, "user collapsed a short list");
  assert.equal(resolveSessionTimelineExpanded(10, true), true, "user expanded a long list");
});
