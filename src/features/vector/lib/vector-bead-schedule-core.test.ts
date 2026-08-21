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

// ── ROSTER FAIRNESS (2026-08-19) ─────────────────────────────────────────────────────
//
// The scheduler scanned from index 0 every tick, so a BINDING ceiling served the same prefix
// forever. Simulated against the shipped defaults this was not degradation but total starvation:
// roster 122 / limit 64 over one RTH session gave the head 4680 samples each and the tail 0.
//
// Live confirmation from the session that prompted this: SPX 3964 samples, NVDA 546, QQQ 557,
// SPY 194, with holes up to 59 minutes — and the rail drew ~10 strike rows on SPX against ONE on
// NVDA, because a row needs samples over time to survive the trail's continuity test.

/** One RTH session of 5s ticks; a record settles before the next tick. */
function simulate(rosterSize: number, limit: number, ticks: number, rotate: boolean) {
  const tickers = Array.from({ length: rosterSize }, (_, i) => `T${String(i).padStart(3, "0")}`);
  const inFlight = new Set<string>();
  const settleAt = new Map<string, number>();
  const count = new Map<string, number>(tickers.map((t) => [t, 0]));
  let cursor = 0;
  for (let tick = 0; tick < ticks; tick++) {
    for (const [t, at] of [...settleAt]) if (at <= tick) { inFlight.delete(t); settleAt.delete(t); }
    const d = selectTickersToRecord({
      tickers,
      inFlight,
      limit,
      ...(rotate ? { cursor } : {}),
    });
    cursor = d.nextCursor;
    for (const t of d.start) {
      inFlight.add(t);
      settleAt.set(t, tick + 1);
      count.set(t, count.get(t)! + 1);
    }
  }
  return tickers.map((t) => count.get(t)!);
}

test("WITHOUT rotation a binding ceiling starves the tail completely (the shipped bug)", () => {
  const counts = simulate(122, 64, 4680, false);
  assert.equal(Math.min(...counts.slice(64)), 0, "tail should be starved without rotation");
  assert.equal(Math.min(...counts.slice(0, 64)), 4680, "head should record every tick");
});

test("WITH rotation every ticker records, and the spread is tight", () => {
  const counts = simulate(122, 64, 4680, true);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  assert.ok(min > 0, `every ticker must record at least once (min ${min})`);
  // Round-robin should divide the ticks almost evenly: 4680 ticks x 64 slots / 122 tickers ~ 2455.
  assert.ok(min > 2000, `worst-served ticker only got ${min} samples`);
  assert.ok(max / min < 1.2, `unfair spread: max ${max} vs min ${min}`);
});

test("every ticker reaches the front within ceil(roster / limit) ticks", () => {
  // The bound that makes worst-case cadence computable instead of infinite.
  const roster = 122;
  const limit = 64;
  const tickers = Array.from({ length: roster }, (_, i) => `T${String(i).padStart(3, "0")}`);
  const started = new Set<string>();
  let cursor = 0;
  const bound = Math.ceil(roster / limit);
  for (let i = 0; i < bound; i++) {
    const d = selectTickersToRecord({ tickers, inFlight: new Set(), limit, cursor });
    cursor = d.nextCursor;
    for (const t of d.start) started.add(t);
  }
  assert.equal(started.size, roster, `only ${started.size}/${roster} tickers served in ${bound} ticks`);
});

test("a shrinking roster or a huge cursor cannot throw or skip the head", () => {
  const tickers = ["A", "B", "C"];
  for (const cursor of [0, 3, 7, 1_000_000, -4]) {
    const d = selectTickersToRecord({ tickers, inFlight: new Set(), limit: 2, cursor });
    assert.equal(d.start.length, 2, `cursor ${cursor} started ${d.start.length}`);
    assert.ok(d.nextCursor >= 0 && d.nextCursor < tickers.length, `cursor ${cursor} -> ${d.nextCursor}`);
  }
});

test("omitting cursor keeps the original index-0 behaviour for one-shot callers", () => {
  const tickers = ["A", "B", "C", "D"];
  const d = selectTickersToRecord({ tickers, inFlight: new Set(), limit: 2 });
  assert.deepEqual(d.start, ["A", "B"], "a caller with no next tick must not be rotated");
});
