import assert from "node:assert/strict";
import { test } from "node:test";
import { spxConfluenceNarrative } from "./spx-confluence-narrative";

test("spxConfluenceNarrative: clean agreeing read, no conflicts, confidence omitted", () => {
  const out = spxConfluenceNarrative({
    action: "BUY_CALL",
    bias: "bullish",
    score: 62,
    grade: "A",
    agreeing: 4,
    conflicts: 0,
    weighted_conflicts: 0,
    direction: "long",
    confidence_omitted: "omitted — no calibrated model.",
  });
  assert.ok(out);
  assert.match(out!, /leans toward buying calls/);
  assert.match(out!, /confluence score 62/);
  assert.match(out!, /grading A/);
  assert.match(out!, /4 factors agree, with no conflicting factors/);
  assert.match(out!, /Direction: long/);
  assert.match(out!, /No calibrated confidence is available/);
});

test("spxConfluenceNarrative: real disagreement is named, not smoothed over", () => {
  const out = spxConfluenceNarrative({
    action: "BUY_PUT",
    bias: "bearish",
    score: -38,
    grade: "C",
    agreeing: 2,
    conflicts: 3,
    weighted_conflicts: 5.5,
    direction: "short",
  });
  assert.ok(out);
  assert.match(out!, /2 factors agree against 3 conflicting \(weighted conflict 5\.5\) — real disagreement/);
  // No confidence_omitted key on this payload -> narrative must not claim one was omitted.
  assert.ok(!out!.includes("No calibrated confidence"));
});

test("spxConfluenceNarrative: singular factor count reads naturally", () => {
  const out = spxConfluenceNarrative({
    action: "HOLD",
    bias: "neutral",
    score: 4,
    grade: "D",
    agreeing: 1,
    conflicts: 0,
  });
  assert.ok(out);
  assert.match(out!, /is holding, not adding fresh risk/);
  assert.match(out!, /1 factor agree, with no conflicting factors/);
  // No direction field on this payload -> never infer one from bias.
  assert.ok(!out!.includes("Direction:"));
});

test("spxConfluenceNarrative: unknown action falls back honestly instead of guessing a verb", () => {
  const out = spxConfluenceNarrative({
    action: "SCANNING",
    bias: "neutral",
    score: 0,
    grade: "D",
  });
  assert.ok(out);
  assert.match(out!, /is at SCANNING/);
});

test("spxConfluenceNarrative: returns null for an error payload rather than narrating an absence", () => {
  assert.equal(
    spxConfluenceNarrative({ error: "No confluence available — SPX desk not live yet." }),
    null
  );
});

test("spxConfluenceNarrative: returns null when core scalar fields are missing/malformed", () => {
  assert.equal(spxConfluenceNarrative({ action: "BUY_CALL", bias: "bullish" }), null);
  assert.equal(
    spxConfluenceNarrative({ action: "BUY_CALL", bias: "bullish", score: "62", grade: "A" }),
    null
  );
  assert.equal(spxConfluenceNarrative({}), null);
});

test("spxConfluenceNarrative: ignores a bogus direction value rather than rendering it verbatim", () => {
  const out = spxConfluenceNarrative({
    action: "WAIT",
    bias: "neutral",
    score: 0,
    grade: "D",
    direction: "sideways",
  });
  assert.ok(out);
  assert.ok(!out!.includes("Direction:"));
});
