// Pure-logic tests for swing-persistence-recall.mjs's cohort split — copied inline in the
// script itself (plain .mjs, no TS path aliases) but exercised here via a light re-import
// trick so the predicate logic doesn't drift silently from accumulation-store.ts's own
// meetsPersistence/hasCorroboration.
//
// 2026-09-08: BREAKOUT/PULLBACK_CONTINUATION/MEAN_REVERSION/FLOW_ACCUMULATION/SECTOR_ROTATION
// loosened from a flat 2-session/no-corroboration floor to 1-session+corroboration (matching
// EVENT_DRIVEN) after this script's own 90-day recall measurement found no forward-outcome
// benefit to the extra calendar-day wait (docs/audit/INTENTIONAL-DESIGN.md item #7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { meetsPersistence, cohortFor } from "../swing-persistence-recall.mjs";

test("meetsPersistence: BREAKOUT clears on 1 session ONLY with 2+ independent signal kinds (2026-09-08 loosening)", () => {
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: ["FLOW"] }), false, "a lone print never promotes");
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: ["FLOW", "STRUCTURE"] }), true);
  assert.equal(meetsPersistence({ archetype: "BREAKOUT", distinct_session_days: 2, last_session_signal_kinds: [] }), true, "2nd session also satisfies corroboration's own fast-path");
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

test("cohortFor: a 1-session, single-kind BREAKOUT sighting (no corroboration yet) is BLOCKED", () => {
  assert.equal(
    cohortFor({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: ["FLOW"], promoted_position_id: null }),
    "BLOCKED"
  );
});

test("cohortFor: the live 2026-09-08 EWY shape (1 session, FLOW+VECTOR corroboration) is now CLEARED under the loosened rule", () => {
  // EWY's real signalKinds that day were ["FLOW", "VECTOR"] — 2 distinct kinds satisfies
  // corroboration, so this specific live anecdote flips from BLOCKED (pre-2026-09-08) to CLEARED.
  assert.equal(
    cohortFor({ archetype: "BREAKOUT", distinct_session_days: 1, last_session_signal_kinds: ["FLOW", "VECTOR"], promoted_position_id: null }),
    "CLEARED"
  );
});
