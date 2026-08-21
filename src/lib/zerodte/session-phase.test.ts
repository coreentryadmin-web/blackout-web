import { strict as assert } from "node:assert";
import test from "node:test";
import { currentZerodteSessionAnchor } from "./session-phase";

// The clock is real here (reads ET now), so we assert on STRUCTURE and INVARIANTS rather than a
// fixed phase — the defect was a missing/invented anchor, and these guard that it is present and
// self-consistent whatever the wall-clock says when the suite runs.

test("the anchor always carries a phase and a present-tense note", () => {
  const a = currentZerodteSessionAnchor();
  assert.ok(
    ["PRE_MARKET", "OPENING_DRIVE", "RTH", "POST_COMMIT", "LATE_SESSION", "CLOSED"].includes(a.session_state),
    `unexpected phase ${a.session_state}`
  );
  assert.ok(typeof a.session_note === "string" && a.session_note.length > 0);
});

test("the note and the phase never contradict each other on market-open", () => {
  const a = currentZerodteSessionAnchor();
  // The live defect was a note claiming the market was open while it was pre-market. Whatever the
  // phase, the note's open/closed claim must match it.
  if (a.session_state === "PRE_MARKET") {
    assert.match(a.session_note, /NOT open yet|pre-market/i);
  }
  if (a.session_state === "CLOSED") {
    assert.match(a.session_note, /closed/i);
  }
  if (a.session_state === "RTH") {
    assert.match(a.session_note, /open/i);
    assert.doesNotMatch(a.session_note, /pre-market/i);
  }
});

test("the ET anchor is a real ET stamp and session date, not a bare UTC instant", () => {
  const a = currentZerodteSessionAnchor(Date.UTC(2026, 7, 21, 9, 0, 0)); // 05:00 ET — pre-market
  assert.match(String(a.as_of_et), /ET|-0[45]:00|[AP]M/i);
  assert.match(String(a.session_date), /^\d{4}-\d{2}-\d{2}$/);
});
