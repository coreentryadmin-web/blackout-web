import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_BUCKETS,
  bucketForScore,
  gradeDirection,
  summarizeByBucket,
  crossFloorComparison,
  scoreSeparation,
} from "./score-floor-backtest-eval.mjs";

const WINDOW = { entryUtcMin: 14 * 60, closeUtcMin: 20 * 60, fav: 0.015, adv: 0.0075 };
const bar = (hhmmUtc, o, h, l, c) => {
  const [hh, mm] = hhmmUtc.split(":").map(Number);
  const d = new Date(Date.UTC(2026, 8, 9, hh, mm));
  return { t: d.getTime(), o, h, l, c };
};

test("buckets straddle the shipped 65 floor exactly", () => {
  assert.equal(bucketForScore(64.999), "55-64 (blocked today)");
  assert.equal(bucketForScore(65), "65-74 (clears today)");
  assert.equal(bucketForScore(54.999), "40-54");
  assert.equal(bucketForScore(0), "0-39");
  assert.equal(bucketForScore(100), "85-100");
  // Every band must be reachable, or the histogram silently hides a population.
  const reached = new Set([10, 45, 60, 70, 80, 95].map(bucketForScore));
  assert.equal(reached.size, SCORE_BUCKETS.length);
});

test("an unscoreable value is null, never bucketed as zero", () => {
  for (const bad of [null, undefined, Number.NaN, "x", -1, 101]) {
    assert.equal(bucketForScore(bad), null, `${String(bad)} must not fall into a bucket`);
  }
});

test("gradeDirection: long wins on favorable-first, mirrors short", () => {
  const barsLong = [
    bar("14:00", 100, 100, 100, 100),
    bar("14:01", 100, 101.6, 99.9, 101.5), // +1.5% hit, no -0.75% touch
  ];
  const gLong = gradeDirection(barsLong, "long", WINDOW);
  assert.equal(gLong.win, true);

  const barsShort = [
    bar("14:00", 100, 100, 100, 100),
    bar("14:01", 100, 100.1, 98.4, 98.5), // -1.5% hit, no +0.75% touch
  ];
  const gShort = gradeDirection(barsShort, "short", WINDOW);
  assert.equal(gShort.win, true);
});

test("gradeDirection: adverse-first (before favorable) is a loss, not a coin flip", () => {
  const bars = [
    bar("14:00", 100, 100, 100, 100),
    bar("14:01", 100, 100.2, 99.2, 99.3), // hits -0.75% adverse, never reaches +1.5%
    bar("14:02", 99.3, 102, 99, 101.6), // later reaches favorable — must not un-lose the row
  ];
  const g = gradeDirection(bars, "long", WINDOW);
  assert.equal(g.win, false);
});

test("gradeDirection: same-bar ambiguity grades pessimistic (loss), never a win", () => {
  const bars = [
    bar("14:00", 100, 100, 100, 100),
    bar("14:01", 100, 101.6, 99.2, 100), // both levels touched in the SAME bar
  ];
  const g = gradeDirection(bars, "long", WINDOW);
  assert.equal(g.win, false);
});

test("gradeDirection: fewer than 2 usable RTH bars is null, never a fabricated coin flip", () => {
  assert.equal(gradeDirection([], "long", WINDOW), null);
  assert.equal(gradeDirection([bar("14:00", 100, 100, 100, 100)], "long", WINDOW), null);
  // Bars entirely outside the entry/close window don't count as usable either.
  const offWindow = [bar("10:00", 100, 100, 100, 100), bar("10:01", 100, 101, 99, 100)];
  assert.equal(gradeDirection(offWindow, "long", WINDOW), null);
});

test("gradeDirection: a non-positive entry price cannot yield a percentage", () => {
  const bars = [bar("14:00", 0, 0, 0, 0), bar("14:01", 0, 1, -1, 0.5)];
  assert.equal(gradeDirection(bars, "long", WINDOW), null);
});

test("summarizeByBucket counts only graded rows, skips unbucketable, preserves band order", () => {
  const rows = [
    { score: 70, graded: { win: true, maxRet: 0.02 } },
    { score: 72, graded: { win: false, maxRet: 0.005 } },
    { score: 30, graded: { win: true, maxRet: 0.01 } },
    { score: 70, graded: null }, // ungraded — must be skipped
    { score: null, graded: { win: true, maxRet: 0.09 } }, // unbucketable — skipped
  ];
  const s = summarizeByBucket(rows);
  assert.deepEqual(s.map((x) => x.bucket), ["0-39", "65-74 (clears today)"]);
  const clears = s.find((x) => x.bucket.startsWith("65-74"));
  assert.equal(clears.n, 2, "the ungraded row must not be counted");
  assert.equal(clears.wins, 1);
  assert.equal(clears.winRate, 50);
  assert.ok(Math.abs(clears.avgMaxRetPct - 1.25) < 1e-9);
});

test("crossFloorComparison names the exact 55-64 vs 65-74 delta this backtest exists to answer", () => {
  const summary = [
    { bucket: "55-64 (blocked today)", n: 40, winRate: 30 },
    { bucket: "65-74 (clears today)", n: 40, winRate: 55 },
  ];
  const c = crossFloorComparison(summary);
  assert.equal(c.deltaPp, 25);
  assert.equal(c.below.winRate, 30);
  assert.equal(c.above.winRate, 55);
});

test("crossFloorComparison is null (not zero) when a band is entirely absent", () => {
  assert.equal(crossFloorComparison([{ bucket: "0-39", n: 5, winRate: 40 }]), null);
});

test("scoreSeparation is re-exported unchanged from helix-score-eval.mjs (same verdict language)", () => {
  const thin = summarizeByBucket([
    { score: 70, graded: { win: true, maxRet: 0.01 } },
    { score: 30, graded: { win: false, maxRet: 0.01 } },
  ]);
  const r = scoreSeparation(thin, 30);
  assert.equal(r.verdict, "INSUFFICIENT DATA");
});
