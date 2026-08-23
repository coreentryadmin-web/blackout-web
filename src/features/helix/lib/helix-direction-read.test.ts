import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_READABLE_PCT_FOR_COLOR,
  readDirection,
  readDirectionTitle,
  directionTone,
  type DirectionReadFlow,
} from "./helix-direction-read";

/** A print with a definite side. ask_pct >= 60 is bought, <= 40 is sold. */
const boughtCall = (premium: number): DirectionReadFlow => ({ option_type: "CALL", ask_pct: 85, premium });
const soldCall = (premium: number): DirectionReadFlow => ({ option_type: "CALL", ask_pct: 12, premium });
const boughtPut = (premium: number): DirectionReadFlow => ({ option_type: "PUT", ask_pct: 90, premium });
/** The index feed: no ask side at all, which is where 94–97% of Monthly/LEAPS premium lives. */
const unsided = (premium: number): DirectionReadFlow => ({ option_type: "CALL", ask_pct: null, premium });

test("a horizon of SOLD calls is bearish — the defect, stated as a test", () => {
  // Under the old rule this bucket is 100% call premium and rendered GREEN.
  const d = readDirection([soldCall(10_000_000), soldCall(5_000_000)]);
  assert.equal(d.label, "bearish");
  assert.equal(directionTone(d), "bear");
});

test("a horizon of BOUGHT calls is still bullish — the fix does not invert the common case", () => {
  const d = readDirection([boughtCall(10_000_000), boughtCall(5_000_000)]);
  assert.equal(d.label, "bullish");
  assert.equal(directionTone(d), "bull");
});

test("mostly-unreadable premium yields NO colour, however the readable slice leans", () => {
  // The live LEAPS shape: $8.19B of $8.46B carries no ask side. The readable slice is lopsidedly
  // bullish and must still not colour the bar — a verdict resting on 3% of the premium is not a
  // verdict, and a green bar over $8B of unknown direction is the defect at its largest.
  const d = readDirection([boughtCall(300_000_000), unsided(8_200_000_000)]);
  assert.equal(d.minorityEvidence, true);
  assert.equal(d.label, "undetermined");
  assert.equal(directionTone(d), null);
  assert.ok(d.readablePct != null && d.readablePct < 5, `readablePct was ${d.readablePct}`);
});

test("the readable share is reported even when it is tiny — neutral must not read as balanced", () => {
  const d = readDirection([boughtCall(1), unsided(99)]);
  assert.equal(Math.round(d.readablePct!), 1);
  const title = readDirectionTitle(d);
  assert.match(title, /Direction not shown/);
  assert.match(title, /could not be read/);
});

test("an empty horizon reports readablePct null, never 0", () => {
  // 0% would say "we measured, and none of it was readable". Nothing was measured.
  const d = readDirection([]);
  assert.equal(d.readablePct, null);
  assert.equal(d.label, "undetermined");
  assert.equal(directionTone(d), null);
  assert.match(readDirectionTitle(d), /No premium in this horizon/);
});

test("the colour gate and directionLabel's own refusal agree at the boundary", () => {
  // directionLabel refuses when unreadable > readable; this module refuses below 50% readable.
  // Exactly 50/50 is the seam and both must permit a read there, so the two rules cannot disagree
  // about a bucket depending on which one a future caller happens to ask.
  const even = readDirection([boughtCall(50), unsided(50)]);
  assert.equal(even.readablePct, MIN_READABLE_PCT_FOR_COLOR);
  assert.equal(even.minorityEvidence, false);
  assert.equal(even.label, "bullish");

  const justUnder = readDirection([boughtCall(49), unsided(51)]);
  assert.equal(justUnder.minorityEvidence, true);
  assert.equal(justUnder.label, "undetermined");
});

test("genuinely two-sided readable premium is MIXED, not silently rounded to a side", () => {
  // The live "This week" shape: bull and bear within a fraction of a percent of each other. It
  // rendered green. Mixed and bullish are different findings and must render differently.
  const d = readDirection([boughtCall(26_231_879), boughtPut(26_302_085)]);
  assert.equal(d.label, "mixed");
  assert.equal(directionTone(d), null);
  assert.equal(d.minorityEvidence, false);
});

test("call and put premium do not decide the colour any more", () => {
  // 90% of the premium is calls, and every one was sold. The old rule: green. The shipped rule:
  // bearish. This is the single assertion that the panel changed rule rather than threshold.
  const d = readDirection([soldCall(900_000), boughtCall(100_000)]);
  assert.equal(d.label, "bearish");
  assert.equal(directionTone(d), "bear");
});

test("the tooltip states the basis, the split and the coverage — all three", () => {
  const d = readDirection([boughtCall(60), boughtPut(20), unsided(20)]);
  const title = readDirectionTitle(d);
  assert.match(title, /Direction read from 80% of this horizon's premium/);
  assert.match(title, /\$60 bullish vs \$20 bearish/);
  assert.match(title, /\$20 could not be read/);
  // The rule itself, so a member can check the colour against the numbers rather than trust it.
  assert.match(title, /sold calls and bought puts are bearish/i);
});

/* ── The Net Premium leaderboard / ticker-drawer cases ───────────────────────────────────────────
 * Same derivation, a different aggregation. The panel's `net` (calls − puts) is a NAMED quantity
 * and its definition is not in question; what these pin is that DIRECTION is a separate claim and
 * is allowed to differ from `net`'s sign — because on the live tape it differs on 7 of the top 10.
 */

test("a big POSITIVE net premium built out of SOLD calls reads bearish", () => {
  // net = +$9M, so the old rule renders a green triangle-up. Every one of those calls was sold.
  const d = readDirection([soldCall(10_000_000), boughtPut(1_000_000)]);
  assert.equal(d.label, "bearish");
  assert.equal(directionTone(d), "bear");
});

test("the live SPX row: a verdict is refused over premium that is 0.1% readable", () => {
  // $4.02B of net premium under a green triangle-up, with 0.1% of the direction readable. The
  // single worst instance found, and it was the leaderboard's top row.
  const d = readDirection([boughtCall(4_000_000), unsided(4_000_000_000)]);
  assert.equal(d.minorityEvidence, true);
  assert.equal(directionTone(d), null);
  assert.ok(d.readablePct != null && d.readablePct < 1);
});

test("a well-covered one-sided ticker keeps its verdict — the rule does not just flatten the panel", () => {
  // AMD, MU and SMH agreed on the live run at 100% / 85.5% / 94.6% readable. If the honest rule
  // neutralised everything it would be useless, so this pins that it does not.
  const bullish = readDirection([boughtCall(5_000_000), boughtCall(3_000_000)]);
  assert.equal(directionTone(bullish), "bull");
  const bearish = readDirection([boughtPut(5_000_000), soldCall(3_000_000)]);
  assert.equal(directionTone(bearish), "bear");
});

test("direction and net-premium sign are independent — neither is derived from the other", () => {
  // All four combinations must be reachable, or one of the two numbers is redundant and the panel
  // is showing the same fact twice while implying it is showing two.
  const cases = [
    { flows: [boughtCall(10)], net: 10, tone: "bull" },   // +net, bullish
    { flows: [soldCall(10)], net: 10, tone: "bear" },      // +net, bearish  <- the hidden case
    { flows: [boughtPut(10)], net: -10, tone: "bear" },    // -net, bearish
    { flows: [{ option_type: "PUT", ask_pct: 5, premium: 10 } as DirectionReadFlow], net: -10, tone: "bull" }, // -net, bullish (puts sold)
  ] as const;
  for (const c of cases) {
    assert.equal(directionTone(readDirection([...c.flows])), c.tone, JSON.stringify(c.flows));
  }
});
