import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionQualityDelta, sessionWindowQuality } from "./spx-signals";

// ---------------------------------------------------------------------------
// A CONFIDENCE MODIFIER ADDED TO A SIGNED SCORE INVERTS FOR ONE SIDE.
//
// The confluence score encodes direction AND conviction in one number: positive is long, negative
// is short (the `provisionalDir` derivation in the scorer says so outright). The session-quality
// modifier was added straight onto it, so for every SHORT setup it did the opposite of its label:
//
//   lunch chop (-8):  long  +70 -> +62  weaker (intended)
//                     short -70 -> -78  STRONGER — the "low quality window" penalty UPGRADED it
//   ORB / power (+6): long  +70 -> +76  stronger (intended)
//                     short -70 -> -64  WEAKER — the "high quality window" bonus DOWNGRADED it
//
// During 11:30–13:00 ET — the window this code itself calls the lowest quality of the day — a
// bearish SPX read GAINED conviction. That moves grade, conviction %, and whether the play clears
// its floor at all.
// ---------------------------------------------------------------------------

const at = (h: number, m: number) => h * 60 + m;

test("session windows classify at their documented boundaries", () => {
  assert.equal(sessionWindowQuality(at(9, 49)).weight, 0, "before the ORB window opens");
  assert.equal(sessionWindowQuality(at(9, 50)).weight, 6, "ORB window is inclusive at open");
  assert.equal(sessionWindowQuality(at(11, 29)).weight, 6);
  assert.equal(sessionWindowQuality(at(11, 30)).weight, -8, "lunch chop takes over exactly at 11:30");
  assert.equal(sessionWindowQuality(at(12, 59)).weight, -8);
  assert.equal(sessionWindowQuality(at(13, 0)).weight, 0, "lunch chop ends at 13:00");
  assert.equal(sessionWindowQuality(at(15, 0)).weight, 6, "power hour");
  assert.equal(sessionWindowQuality(at(15, 30)).weight, 0, "power hour is exclusive at close");
});

test("REGRESSION: a lunch-chop PENALTY weakens a short instead of strengthening it", () => {
  const short = -70;
  const delta = sessionQualityDelta(short, -8);
  assert.equal(delta, 8, "the penalty must move a short TOWARD neutral");
  assert.equal(short + delta, -62);
  assert.ok(Math.abs(short + delta) < Math.abs(short), "conviction must fall in a low-quality window");
});

test("REGRESSION: a high-quality BONUS strengthens a short instead of weakening it", () => {
  const short = -70;
  const delta = sessionQualityDelta(short, 6);
  assert.equal(delta, -6);
  assert.equal(short + delta, -76);
  assert.ok(Math.abs(short + delta) > Math.abs(short), "conviction must rise in a high-quality window");
});

test("long-side behaviour is unchanged — it was always correct", () => {
  assert.equal(70 + sessionQualityDelta(70, -8), 62);
  assert.equal(70 + sessionQualityDelta(70, 6), 76);
});

test("the modifier always moves conviction the SAME way for both directions", () => {
  for (const weight of [-8, 6]) {
    const longAfter = Math.abs(70 + sessionQualityDelta(70, weight));
    const shortAfter = Math.abs(-70 + sessionQualityDelta(-70, weight));
    assert.equal(longAfter, shortAfter, `weight ${weight}: both sides must end at the same conviction`);
  }
});

test("a directionless score is left alone rather than guessed at", () => {
  assert.equal(sessionQualityDelta(0, -8), 0);
  assert.equal(sessionQualityDelta(0, 6), 0);
  assert.equal(sessionQualityDelta(-70, 0), 0, "no modifier outside the three windows");
});

test("THE MEMBER-FACING CONSEQUENCE: lunch chop could promote a short from HOLD to BUY_PUT", () => {
  // The scorer's action gate is `score <= -22 -> BUY_PUT`, `abs >= 10 -> HOLD`. A bearish read
  // sitting at -18 is a HOLD. Under the old signed addition the lunch-chop penalty pushed it to
  // -26 and it became a BUY_PUT — the lowest-quality window of the day MANUFACTURING a put-buy
  // signal, which is the exact opposite of raising the bar.
  const BUY_PUT_GATE = -22;
  const borderlineShort = -18;

  const oldWay = borderlineShort + -8; // what shipped: the raw modifier added straight on
  assert.ok(oldWay <= BUY_PUT_GATE, "precondition: the old path did cross the BUY_PUT gate");

  const newWay = borderlineShort + sessionQualityDelta(borderlineShort, -8);
  assert.equal(newWay, -10);
  assert.ok(newWay > BUY_PUT_GATE, "a low-quality window must never promote a setup to BUY_PUT");
});

test("…and a high-quality window no longer DEMOTES a qualifying short", () => {
  // Mirror image: a -26 short is a BUY_PUT. The ORB/power-hour bonus used to drag it to -20,
  // demoting it to HOLD in the very windows the model rates highest.
  const qualifyingShort = -26;
  assert.ok(qualifyingShort + 6 > -22, "precondition: the old path demoted it below the gate");
  assert.equal(qualifyingShort + sessionQualityDelta(qualifyingShort, 6), -32);
});
