import { test } from "node:test";
import assert from "node:assert/strict";
import { zeroDteEmptyHint } from "./deck-empty-hint";

const SCANNING = "Scanning the whole market — no 0DTE setup has cleared the floor right now.";

// The defect, reproduced from the REAL payload observed on production 2026-08-23 00:40 UTC
// (Sat, market closed): trading_day:false, heat.state CLOSED, both discovery lanes off_hours.
// The deck rendered "ENGINE Standby" in the header and the scanning sentence in the body.
test("closed market does NOT claim an active scan (the shipped defect)", () => {
  const out = zeroDteEmptyHint({
    degraded: false,
    heatState: "CLOSED",
    heatNote: "No session today — Night Hawk's evening playbook covers the next open.",
  });
  assert.notEqual(out, SCANNING, "a closed market must never render the active-scan sentence");
  assert.match(out, /evening playbook/);
});

test("the payload's own heat.note is preferred over invented copy", () => {
  // One source of truth: board.ts sessionHeat already writes the member-facing line.
  const note = "No session today — Night Hawk's evening playbook covers the next open.";
  assert.equal(zeroDteEmptyHint({ degraded: false, heatState: "CLOSED", heatNote: note }), note);
});

test("pre-market is also not scanning — wrong every weekday before 09:30, not just weekends", () => {
  const out = zeroDteEmptyHint({
    degraded: false,
    heatState: "PRE_MARKET",
    heatNote: "Pre-market: feeds warming, overnight plays confirming, lotto scan pending.",
  });
  assert.notEqual(out, SCANNING);
  assert.match(out, /Pre-market/);
});

test("a legacy payload with no heat.note still gets an honest sentence, never the scan claim", () => {
  for (const state of ["CLOSED", "PRE_MARKET"]) {
    const out = zeroDteEmptyHint({ degraded: false, heatState: state, heatNote: null });
    assert.notEqual(out, SCANNING, `${state} must not fall back to the scan claim`);
    assert.ok(out.length > 0);
  }
  // A blank/whitespace note must not produce an empty hint.
  const blank = zeroDteEmptyHint({ degraded: false, heatState: "CLOSED", heatNote: "   " });
  assert.ok(blank.trim().length > 0);
  assert.notEqual(blank, SCANNING);
});

test("live session states keep the scanning sentence — this fix must not change RTH", () => {
  for (const state of ["RTH", "OPENING_DRIVE"]) {
    assert.equal(
      zeroDteEmptyHint({ degraded: false, heatState: state, heatNote: "All engines live — new 0DTE commits until 3:30 PM ET." }),
      SCANNING,
      `${state} is genuinely scanning`
    );
  }
});

test("POST_COMMIT / LATE_SESSION deliberately keep the scanning sentence", () => {
  // G-14 blocks new DIRECTIONAL commits after 15:30 ET but credit/condor seats stay eligible, so
  // the board really is still scanning. Widening the not-scanning set here would be a copy change
  // with no evidence behind it — pinned so a future edit is a deliberate one.
  for (const state of ["POST_COMMIT", "LATE_SESSION"]) {
    assert.equal(zeroDteEmptyHint({ degraded: false, heatState: state, heatNote: "x" }), SCANNING);
  }
});

test("degraded still wins over everything — an outage is not a closed market", () => {
  const out = zeroDteEmptyHint({ degraded: true, heatState: "CLOSED", heatNote: "note" });
  assert.match(out, /data outage, not a flat tape/);
  assert.notEqual(out, SCANNING);
});

test("unknown heat state falls through to prior behaviour, not a new invented state", () => {
  assert.equal(zeroDteEmptyHint({ degraded: false, heatState: null }), SCANNING);
  assert.equal(zeroDteEmptyHint({ degraded: false, heatState: undefined }), SCANNING);
});

test("heat state matching is case-insensitive", () => {
  assert.notEqual(zeroDteEmptyHint({ degraded: false, heatState: "closed", heatNote: null }), SCANNING);
});
