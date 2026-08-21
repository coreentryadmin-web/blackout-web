import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMeridianDrift, driftSeries, DRIFT_SCORE_FLOOR } from "./meridian-drift-core";

const snap = (day: string, score: number | null, verdict: "bullish" | "bearish" | "neutral" | null, pillars?: Record<string, string>) =>
  ({ day, score, verdict, confidence: null, pillars: pillars ?? null });

test("drift: a single snapshot is not a trend", () => {
  assert.equal(computeMeridianDrift([snap("2026-08-18", 40, "bullish")]), null);
  assert.equal(computeMeridianDrift([]), null);
  assert.equal(computeMeridianDrift(null), null);
});

test("drift: reports the score move and its direction", () => {
  const d = computeMeridianDrift([snap("2026-08-11", 60, "bullish"), snap("2026-08-18", 20, "bullish")])!;
  assert.equal(d.scoreDelta, -40);
  assert.equal(d.direction, "fading");
  assert.equal(d.spanDays, 7);
  assert.match(d.headline, /fading/);
});

test("drift: a move inside the noise floor is 'held', not a direction", () => {
  const d = computeMeridianDrift([snap("2026-08-16", 30, "bullish"), snap("2026-08-18", 30 + DRIFT_SCORE_FLOOR - 1, "bullish")])!;
  assert.equal(d.direction, "flat");
  assert.match(d.headline, /held/i);
  assert.doesNotMatch(d.headline, /firming|fading/i);
});

test("drift: 'held' is a finding, and is not the same statement as 'no data'", () => {
  const d = computeMeridianDrift([snap("2026-08-11", 30, "neutral"), snap("2026-08-18", 31, "neutral")])!;
  assert.match(d.headline, /held/i);
  assert.equal(d.sampleDays, 2);
});

test("drift: a verdict flip is reported even when the score barely moved", () => {
  // Categorical change matters on its own — a reader wants to know it happened.
  const d = computeMeridianDrift([snap("2026-08-17", 2, "bullish"), snap("2026-08-18", -1, "bearish")])!;
  assert.equal(d.verdictFlipped, true);
  assert.match(d.headline, /bullish → bearish/);
});

test("drift: names the pillars that turned", () => {
  const d = computeMeridianDrift([
    snap("2026-08-11", 40, "bullish", { flow: "bullish", thermal: "bullish", news: "neutral" }),
    snap("2026-08-18", 10, "neutral", { flow: "bearish", thermal: "bullish", news: "neutral" }),
  ])!;
  assert.deepEqual(d.turns, [{ pillar: "flow", from: "bullish", to: "bearish" }]);
});

test("drift: a pillar that merely APPEARED has not turned", () => {
  // A feed coming back online is new evidence, not a change of mind. Conflating them would
  // invent a flip every time an outage ended.
  const d = computeMeridianDrift([
    snap("2026-08-11", 40, "bullish", { flow: "bullish" }),
    snap("2026-08-18", 40, "bullish", { flow: "bullish", darkPool: "bearish" }),
  ])!;
  assert.deepEqual(d.turns, []);
});

test("drift: compares against the OLDEST snapshot inside the window, not an exact date", () => {
  // Snapshots only exist on days the warm path ran, so an exact-date lookup returns nothing
  // across a weekend — which is most of an earnings calendar.
  const d = computeMeridianDrift(
    [snap("2026-08-01", 90, "bullish"), snap("2026-08-14", 50, "bullish"), snap("2026-08-18", 10, "neutral")],
    7
  )!;
  assert.equal(d.from.day, "2026-08-14", "08-01 is outside the 7d window");
  assert.equal(d.scoreDelta, -40);
});

test("drift: falls back to the oldest row when nothing sits inside the window", () => {
  const d = computeMeridianDrift([snap("2026-06-01", 90, "bullish"), snap("2026-08-18", 10, "neutral")], 7)!;
  assert.equal(d.from.day, "2026-06-01");
  assert.equal(d.verdictFlipped, true);
});

test("drift: a missing score yields a null delta rather than a fabricated zero", () => {
  const d = computeMeridianDrift([snap("2026-08-11", null, "bullish"), snap("2026-08-18", 20, "bullish")])!;
  assert.equal(d.scoreDelta, null);
  assert.equal(d.direction, "unknown");
});

test("drift: input order does not matter — rows are sorted by day", () => {
  const d = computeMeridianDrift([snap("2026-08-18", 10, "neutral"), snap("2026-08-11", 60, "bullish")])!;
  assert.equal(d.from.day, "2026-08-11");
  assert.equal(d.to.day, "2026-08-18");
});

test("drift: malformed days are dropped, not parsed into nonsense", () => {
  const d = computeMeridianDrift([
    snap("not-a-day", 99, "bullish"),
    snap("2026-08-11", 60, "bullish"),
    snap("2026-08-18", 20, "bullish"),
  ])!;
  assert.equal(d.sampleDays, 2);
  assert.equal(d.from.day, "2026-08-11");
});

test("driftSeries: oldest first, gaps preserved as null", () => {
  const s = driftSeries([snap("2026-08-18", 20, null), snap("2026-08-11", null, null), snap("2026-08-14", 50, null)]);
  assert.deepEqual(s, [null, 50, 20]);
});
