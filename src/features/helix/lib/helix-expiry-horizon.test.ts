import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_READABLE_PCT_FOR_COLOR,
  horizonDirection,
  horizonDirectionTitle,
  horizonTone,
  type HorizonFlow,
} from "./helix-expiry-horizon";

/** A print with a definite side. ask_pct >= 60 is bought, <= 40 is sold. */
const boughtCall = (premium: number): HorizonFlow => ({ option_type: "CALL", ask_pct: 85, premium });
const soldCall = (premium: number): HorizonFlow => ({ option_type: "CALL", ask_pct: 12, premium });
const boughtPut = (premium: number): HorizonFlow => ({ option_type: "PUT", ask_pct: 90, premium });
/** The index feed: no ask side at all, which is where 94–97% of Monthly/LEAPS premium lives. */
const unsided = (premium: number): HorizonFlow => ({ option_type: "CALL", ask_pct: null, premium });

test("a horizon of SOLD calls is bearish — the defect, stated as a test", () => {
  // Under the old rule this bucket is 100% call premium and rendered GREEN.
  const d = horizonDirection([soldCall(10_000_000), soldCall(5_000_000)]);
  assert.equal(d.label, "bearish");
  assert.equal(horizonTone(d), "bear");
});

test("a horizon of BOUGHT calls is still bullish — the fix does not invert the common case", () => {
  const d = horizonDirection([boughtCall(10_000_000), boughtCall(5_000_000)]);
  assert.equal(d.label, "bullish");
  assert.equal(horizonTone(d), "bull");
});

test("mostly-unreadable premium yields NO colour, however the readable slice leans", () => {
  // The live LEAPS shape: $8.19B of $8.46B carries no ask side. The readable slice is lopsidedly
  // bullish and must still not colour the bar — a verdict resting on 3% of the premium is not a
  // verdict, and a green bar over $8B of unknown direction is the defect at its largest.
  const d = horizonDirection([boughtCall(300_000_000), unsided(8_200_000_000)]);
  assert.equal(d.minorityEvidence, true);
  assert.equal(d.label, "undetermined");
  assert.equal(horizonTone(d), null);
  assert.ok(d.readablePct != null && d.readablePct < 5, `readablePct was ${d.readablePct}`);
});

test("the readable share is reported even when it is tiny — neutral must not read as balanced", () => {
  const d = horizonDirection([boughtCall(1), unsided(99)]);
  assert.equal(Math.round(d.readablePct!), 1);
  const title = horizonDirectionTitle(d);
  assert.match(title, /Direction not shown/);
  assert.match(title, /could not be read/);
});

test("an empty horizon reports readablePct null, never 0", () => {
  // 0% would say "we measured, and none of it was readable". Nothing was measured.
  const d = horizonDirection([]);
  assert.equal(d.readablePct, null);
  assert.equal(d.label, "undetermined");
  assert.equal(horizonTone(d), null);
  assert.match(horizonDirectionTitle(d), /No premium in this horizon/);
});

test("the colour gate and directionLabel's own refusal agree at the boundary", () => {
  // directionLabel refuses when unreadable > readable; this module refuses below 50% readable.
  // Exactly 50/50 is the seam and both must permit a read there, so the two rules cannot disagree
  // about a bucket depending on which one a future caller happens to ask.
  const even = horizonDirection([boughtCall(50), unsided(50)]);
  assert.equal(even.readablePct, MIN_READABLE_PCT_FOR_COLOR);
  assert.equal(even.minorityEvidence, false);
  assert.equal(even.label, "bullish");

  const justUnder = horizonDirection([boughtCall(49), unsided(51)]);
  assert.equal(justUnder.minorityEvidence, true);
  assert.equal(justUnder.label, "undetermined");
});

test("genuinely two-sided readable premium is MIXED, not silently rounded to a side", () => {
  // The live "This week" shape: bull and bear within a fraction of a percent of each other. It
  // rendered green. Mixed and bullish are different findings and must render differently.
  const d = horizonDirection([boughtCall(26_231_879), boughtPut(26_302_085)]);
  assert.equal(d.label, "mixed");
  assert.equal(horizonTone(d), null);
  assert.equal(d.minorityEvidence, false);
});

test("call and put premium do not decide the colour any more", () => {
  // 90% of the premium is calls, and every one was sold. The old rule: green. The shipped rule:
  // bearish. This is the single assertion that the panel changed rule rather than threshold.
  const d = horizonDirection([soldCall(900_000), boughtCall(100_000)]);
  assert.equal(d.label, "bearish");
  assert.equal(horizonTone(d), "bear");
});

test("the tooltip states the basis, the split and the coverage — all three", () => {
  const d = horizonDirection([boughtCall(60), boughtPut(20), unsided(20)]);
  const title = horizonDirectionTitle(d);
  assert.match(title, /Direction read from 80% of this horizon's premium/);
  assert.match(title, /\$60 bullish vs \$20 bearish/);
  assert.match(title, /\$20 could not be read/);
  // The rule itself, so a member can check the colour against the numbers rather than trust it.
  assert.match(title, /sold calls and bought puts are bearish/i);
});
