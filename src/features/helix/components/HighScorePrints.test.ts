import test from "node:test";
import assert from "node:assert/strict";
import { scoreTone, rowStyle } from "./HighScorePrints";

// Root cause (2026-08-02 Helix audit, Tier 1 "visual hierarchy"): every Top Prints row used
// scoreTone's own bg/border, and since the top-N by score routinely clusters near the max,
// almost every visible row rendered the same strong gold glow — nothing read as THE
// standout print. This pins the fix: only rank 0 gets the full-strength treatment.
test("rowStyle: only the top-ranked row gets the tone's full background/border/glow", () => {
  const tone = scoreTone(9.5);
  const top = rowStyle(true, tone);
  assert.equal(top.background, tone.bg);
  assert.equal(top.border, `1px solid ${tone.border}`);
  assert.ok(typeof top.boxShadow === "string" && top.boxShadow.length > 0, "top row gets a glow");
});

test("rowStyle: every non-top row is flattened to one quiet neutral style, regardless of tone", () => {
  const goldTone = scoreTone(9.5);
  const blueTone = scoreTone(3);
  const a = rowStyle(false, goldTone);
  const b = rowStyle(false, blueTone);
  assert.deepEqual(a, b, "non-top rows must not vary by score tier");
  assert.equal(a.background, "rgba(255,255,255,0.02)");
  assert.equal(a.border, "1px solid rgba(255,255,255,0.06)");
  assert.equal(a.boxShadow, undefined, "non-top rows carry no glow");
});
