import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chronologicalSplit, expandingWindowFolds } from "./chronological-split";

type Row = { date: string; id: string };
const dateOf = (r: Row) => r.date;

function rows(dates: string[]): Row[] {
  return dates.map((date, i) => ({ date, id: `r${i}` }));
}

describe("chronologicalSplit — cutoffDate mode", () => {
  test("splits strictly at the cutoff: cutoff date itself lands in train, never holdout", () => {
    const data = rows(["2026-09-01", "2026-09-02", "2026-09-02", "2026-09-03", "2026-09-04"]);
    const split = chronologicalSplit(data, dateOf, { cutoffDate: "2026-09-02" });
    assert.equal(split.train.length, 3); // 09-01, 09-02, 09-02
    assert.equal(split.holdout.length, 2); // 09-03, 09-04
    assert.ok(split.train.every((r) => r.date <= "2026-09-02"));
    assert.ok(split.holdout.every((r) => r.date > "2026-09-02"));
  });

  test("no-leakage invariant: every holdout date is strictly greater than every train date", () => {
    const data = rows(["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-15", "2026-09-20"]);
    const split = chronologicalSplit(data, dateOf, { cutoffDate: "2026-09-10" });
    const maxTrainDate = Math.max(...split.train.map((r) => Date.parse(r.date)));
    const minHoldoutDate = Math.min(...split.holdout.map((r) => Date.parse(r.date)));
    assert.ok(minHoldoutDate > maxTrainDate);
  });

  test("cutoff after every date -> holdout empty, degenerate true", () => {
    const data = rows(["2026-09-01", "2026-09-02"]);
    const split = chronologicalSplit(data, dateOf, { cutoffDate: "2026-12-31" });
    assert.equal(split.holdout.length, 0);
    assert.equal(split.train.length, 2);
    assert.equal(split.degenerate, true);
  });

  test("cutoff before every date -> train empty, degenerate true", () => {
    const data = rows(["2026-09-01", "2026-09-02"]);
    const split = chronologicalSplit(data, dateOf, { cutoffDate: "2026-01-01" });
    assert.equal(split.train.length, 0);
    assert.equal(split.holdout.length, 2);
    assert.equal(split.degenerate, true);
  });
});

describe("chronologicalSplit — holdoutFraction mode", () => {
  test("cuts along DISTINCT DATES, not row count, so a high-volume date doesn't skew the split", () => {
    // 3 distinct dates: 09-01 has 1 row, 09-02 has 10 rows, 09-03 has 1 row.
    const data = [
      { date: "2026-09-01", id: "a" },
      ...Array.from({ length: 10 }, (_, i) => ({ date: "2026-09-02", id: `b${i}` })),
      { date: "2026-09-03", id: "c" },
    ];
    // holdoutFraction=1/3 over 3 distinct dates -> ceil(3 * 1/3) = 1 date held out (09-03).
    const split = chronologicalSplit(data, dateOf, { holdoutFraction: 1 / 3 });
    assert.equal(split.trainEndDate, "2026-09-02");
    assert.equal(split.holdout.length, 1);
    assert.equal(split.train.length, 11);
  });

  test("a tiny dataset still reserves at least one date for holdout (ceil, never rounds to zero)", () => {
    const data = rows(["2026-09-01", "2026-09-02"]);
    const split = chronologicalSplit(data, dateOf, { holdoutFraction: 0.1 });
    assert.ok(split.holdout.length >= 1);
  });

  test("holdoutFraction outside (0,1) throws rather than silently clamping", () => {
    const data = rows(["2026-09-01"]);
    assert.throws(() => chronologicalSplit(data, dateOf, { holdoutFraction: 0 }));
    assert.throws(() => chronologicalSplit(data, dateOf, { holdoutFraction: 1 }));
    assert.throws(() => chronologicalSplit(data, dateOf, { holdoutFraction: 1.5 }));
  });

  test("same-date rows are never split across train/holdout", () => {
    const data = [
      ...Array.from({ length: 5 }, (_, i) => ({ date: "2026-09-01", id: `a${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ date: "2026-09-02", id: `b${i}` })),
    ];
    const split = chronologicalSplit(data, dateOf, { holdoutFraction: 0.5 });
    const trainDates = new Set(split.train.map((r) => r.date));
    const holdoutDates = new Set(split.holdout.map((r) => r.date));
    for (const d of trainDates) assert.ok(!holdoutDates.has(d), `date ${d} leaked into both sides`);
  });
});

describe("chronologicalSplit — empty input", () => {
  test("empty rows -> both sides empty, degenerate true, never throws", () => {
    const split = chronologicalSplit([] as Row[], dateOf, { holdoutFraction: 0.5 });
    assert.deepEqual(split.train, []);
    assert.deepEqual(split.holdout, []);
    assert.equal(split.degenerate, true);
  });
});

describe("expandingWindowFolds", () => {
  test("each successive fold's train window strictly expands", () => {
    const data = rows(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    const folds = expandingWindowFolds(data, dateOf, { minTrainDates: 2, holdoutDatesPerFold: 1 });
    assert.ok(folds.length >= 2);
    for (let i = 1; i < folds.length; i++) {
      assert.ok(folds[i]!.train.length > folds[i - 1]!.train.length, `fold ${i + 1} train did not expand`);
    }
  });

  test("no-leakage invariant holds within every fold", () => {
    const data = rows(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]);
    const folds = expandingWindowFolds(data, dateOf, { minTrainDates: 2, holdoutDatesPerFold: 2 });
    for (const fold of folds) {
      if (fold.train.length === 0 || fold.holdout.length === 0) continue;
      const maxTrainDate = Math.max(...fold.train.map((r) => Date.parse(r.date)));
      const minHoldoutDate = Math.min(...fold.holdout.map((r) => Date.parse(r.date)));
      assert.ok(minHoldoutDate > maxTrainDate, `fold ${fold.fold} leaked`);
    }
  });

  test("fold numbers are sequential starting at 1", () => {
    const data = rows(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
    const folds = expandingWindowFolds(data, dateOf, { minTrainDates: 1, holdoutDatesPerFold: 1 });
    assert.deepEqual(folds.map((f) => f.fold), folds.map((_, i) => i + 1));
  });

  test("maxFolds caps the number of folds returned", () => {
    const data = rows(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    const folds = expandingWindowFolds(data, dateOf, { minTrainDates: 1, holdoutDatesPerFold: 1, maxFolds: 2 });
    assert.equal(folds.length, 2);
  });

  test("never fabricates a fold when the data runs out first", () => {
    const data = rows(["2026-09-01", "2026-09-02"]);
    const folds = expandingWindowFolds(data, dateOf, { minTrainDates: 5, holdoutDatesPerFold: 1, maxFolds: 10 });
    assert.deepEqual(folds, []);
  });

  test("empty input -> no folds, never throws", () => {
    const folds = expandingWindowFolds([] as Row[], dateOf, { minTrainDates: 1, holdoutDatesPerFold: 1 });
    assert.deepEqual(folds, []);
  });
});
