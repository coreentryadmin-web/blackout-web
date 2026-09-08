// Pure-logic tests for swing-persistence-recall.mjs's cohort split — copied inline in the
// script itself (plain .mjs, no TS path aliases) but exercised here via a light re-import
// trick so the predicate logic doesn't drift silently from accumulation-store.ts's own
// meetsPersistence/hasCorroboration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meetsPersistence, cohortFor } from "../swing-persistence-recall.mjs";

test("meetsPersistence: cross-session archetype (BREAKOUT) needs 2 distinct sessions, corroboration irrelevant", () => {
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: ["FLOW", "STRUCTURE"] }), false);
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: 2, last_session_signal_kinds: [] }), true);
});

test("meetsPersistence: event archetype (EVENT_DRIVEN) clears on 1 session ONLY with 2+ independent signal kinds", () => {
  assert.equal(meetsPersistence({ archetype: "EVENT_DRIVEN", distinct_session_days: 1, last_session_signal_kinds: ["FLOW"] }), false, "a lone print never promotes");
  assert.equal(meetsPersistence({ archetype: "EVENT_DRIVEN", distinct_session_days: 1, last_session_signal_kinds: ["FLOW", "CATALYST"] }), true);
  assert.equal(meetsPersistence({ archetype: "EVENT_DRIVEN", distinct_session_days: 2, last_session_signal_kinds: [] }), true, "2nd session also satisfies corroboration's own fast-path");
});

test("meetsPersistence: FAILED_BREAKDOWN clears on 1 session alone, no corroboration required", () => {
  assert.equal(meetsPersistence({ archetype: "FAILED_BREAKDOWN", distinct_session_days: 1, last_session_signal_kinds: [] }), true);
});

test("meetsPersistence: unclassified/unknown archetype falls back to the conservative 2-session default", () => {
  assert.equal(meetsPersistence({ archetype: "UNCLASSIFIED", distinct_session_days: 1, last_session_signal_kinds: ["FLOW", "CATALYST"] }), false);
  assert.equal(meetsPersistence({ archetype: "UNCLASSIFIED", distinct_session_days: 2, last_session_signal_kinds: [] }), true);
});

test("meetsPersistence: non-finite distinct_session_days is never a truthy accident", () => {
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: NaN, last_session_signal_kinds: [] }), false);
});

test("cohortFor: an already-promoted row is CLEARED regardless of what the predicate alone would say", () => {
  assert.equal(
    cohortFor({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: [], promoted_position_id: 42 }),
    "CLEARED"
  );
});

test("cohortFor: the live 2026-09-08 EWY shape (TRIGGERED+AT_TRIGGER, 1/2 sessions, cross-session archetype) is BLOCKED", () => {
  assert.equal(
    cohortFor({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: [], promoted_position_id: null }),
    "BLOCKED"
  );
});
