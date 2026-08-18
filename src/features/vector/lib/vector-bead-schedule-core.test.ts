import test from "node:test";
import assert from "node:assert/strict";

import { isFullCoverage, selectTickersToRecord } from "./vector-bead-schedule-core";

const S = (...t: string[]) => new Set(t);

test("THE DEFECT: one slow ticker no longer costs everyone else their tick", () => {
  // Old behaviour: `if (recordInFlight) return` — SPY still running meant NOBODY got sampled.
  const d = selectTickersToRecord({
    tickers: ["SPY", "QQQ", "NVDA", "TSLA", "AAPL"],
    inFlight: S("SPY"),
    limit: 64,
  });
  assert.deepEqual(d.busy, ["SPY"], "the slow one skips itself");
  assert.deepEqual(d.start, ["QQQ", "NVDA", "TSLA", "AAPL"], "everyone else proceeds on schedule");
  assert.deepEqual(d.deferred, []);
});

test("the concurrency ceiling counts records still running from EARLIER ticks", () => {
  // Without this, overlapping sweeps each get their own budget and concurrent upstream reads
  // multiply by the number of sweeps in flight — a latency fix turning into a load problem.
  const d = selectTickersToRecord({
    tickers: ["A", "B", "C", "D"],
    inFlight: S("X", "Y"),
    limit: 3,
  });
  assert.deepEqual(d.start, ["A"], "3 limit - 2 already running = 1 free slot");
  assert.deepEqual(d.deferred, ["B", "C", "D"]);
});

test("caller ordering decides who gets the remaining slots", () => {
  // Sharding and priority live upstream; the scheduler must not reshuffle a deliberate roster.
  const d = selectTickersToRecord({ tickers: ["Z", "Y", "X"], inFlight: S(), limit: 2 });
  assert.deepEqual(d.start, ["Z", "Y"]);
  assert.deepEqual(d.deferred, ["X"]);
});

test("a ticker repeated in the roster is started at most once", () => {
  // Two concurrent records of the same rail would be the duplicate-append problem in a new place.
  const d = selectTickersToRecord({ tickers: ["SPY", "spy", " SPY "], inFlight: S(), limit: 10 });
  assert.deepEqual(d.start, ["SPY"]);
});

test("tickers are matched against inFlight case- and whitespace-insensitively", () => {
  const d = selectTickersToRecord({ tickers: [" spy "], inFlight: S("SPY"), limit: 10 });
  assert.deepEqual(d.busy, ["SPY"]);
  assert.deepEqual(d.start, []);
});

test("everything busy is a valid tick, not an error", () => {
  const d = selectTickersToRecord({ tickers: ["A", "B"], inFlight: S("A", "B"), limit: 64 });
  assert.deepEqual(d.start, []);
  assert.deepEqual(d.busy, ["A", "B"]);
  // Nothing was DEFERRED — the ceiling never bound, the work was simply already running.
  assert.equal(isFullCoverage(d), true);
});

test("isFullCoverage reports the ceiling binding, which is the condition worth alarming on", () => {
  assert.equal(isFullCoverage(selectTickersToRecord({ tickers: ["A"], inFlight: S(), limit: 5 })), true);
  assert.equal(
    isFullCoverage(selectTickersToRecord({ tickers: ["A", "B"], inFlight: S(), limit: 1 })),
    false
  );
});

test("skips are always accounted for — no ticker vanishes from the decision", () => {
  // The old drop was invisible. Every ticker must land in exactly one bucket.
  const tickers = Array.from({ length: 40 }, (_, i) => `T${i}`);
  const inFlight = S("T0", "T1", "T2");
  const d = selectTickersToRecord({ tickers, inFlight, limit: 10 });
  assert.equal(d.start.length + d.busy.length + d.deferred.length, tickers.length);
  assert.equal(d.busy.length, 3);
  assert.equal(d.start.length, 7, "10 limit - 3 running = 7 starts");
});

test("a nonsense limit still starts exactly one ticker rather than none or all", () => {
  for (const limit of [0, -5, Number.NaN]) {
    const d = selectTickersToRecord({ tickers: ["A", "B"], inFlight: S(), limit });
    assert.equal(d.start.length, 1, `limit ${String(limit)} must not stall or unbound the sweep`);
  }
});

test("empty and unusable input is tolerated", () => {
  assert.deepEqual(selectTickersToRecord({ tickers: [], inFlight: S(), limit: 5 }).start, []);
  assert.deepEqual(selectTickersToRecord({ tickers: ["", "  "], inFlight: S(), limit: 5 }).start, []);
});
