import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

let sharedUniverse: string[] = [];
let openPositions: Array<{ ticker: string }> = [];
let fetchOpenSwingPositionsShouldThrow = false;

mock.module("./vector-dynamic-universe", {
  namedExports: {
    listSharedUniverseTickers: async () => sharedUniverse,
    mergeSharedUniverseTickers: (staticList: string[], dynamicList: string[]) => [
      ...new Set(
        [...staticList, ...dynamicList].map((t) => String(t).trim().toUpperCase()).filter(Boolean)
      ),
    ],
  },
});

mock.module("../../../lib/db", {
  namedExports: {
    fetchOpenSwingPositions: async () => {
      if (fetchOpenSwingPositionsShouldThrow) throw new Error("db unavailable");
      return openPositions;
    },
  },
});

let activeVectorFullStateTickers: typeof import("./vector-full-state-warm-universe").activeVectorFullStateTickers;
let rotateTickersForWarmPass: typeof import("./vector-full-state-warm-universe").rotateTickersForWarmPass;

before(async () => {
  ({ activeVectorFullStateTickers, rotateTickersForWarmPass } = await import(
    "./vector-full-state-warm-universe"
  ));
});

test("unions the shared static/dynamic universe with real open swing-position tickers", async () => {
  sharedUniverse = ["SPY", "SPX", "AAPL"];
  openPositions = [{ ticker: "HUT" }, { ticker: "MSTR" }];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "SPX", "AAPL", "HUT", "MSTR"]));
});

test("de-duplicates an open swing position already inside the shared universe", async () => {
  sharedUniverse = ["SPY", "AAPL"];
  openPositions = [{ ticker: "AAPL" }, { ticker: "HUT" }];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.equal(out.filter((t) => t === "AAPL").length, 1);
  assert.ok(out.includes("HUT"));
});

test("a DB failure degrades to the shared universe alone, never throws", async () => {
  sharedUniverse = ["SPY", "AAPL"];
  openPositions = [];
  fetchOpenSwingPositionsShouldThrow = true;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "AAPL"]));
});

test("no open positions leaves the shared universe untouched", async () => {
  sharedUniverse = ["SPY", "SPX"];
  openPositions = [];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(new Set(out), new Set(["SPY", "SPX"]));
});

// BUG FIXED 2026-10-08 (Ask Largo standing mandate): open positions used to be APPENDED after the
// shared static/dynamic universe, which `rotateTickersForWarmPass`'s cursor walks in THIS exact
// order — so real committed capital was always the LAST thing warmed in every rotation lap, not
// the first. Confirmed live ~2h after the TTL fix (#5705) deployed: CIEG/MRNA/PSX (real open swing
// positions) were still hard-timing out (`SwingBriefSourceTimeout`, 8000ms) on Ask Largo's swing
// play-brief because the lap simply hadn't reached their tail position yet. A long TTL cannot help
// an entry that is never first in line to be (re)warmed each lap.
test("open swing positions are ordered FIRST, ahead of the shared static/dynamic universe — the highest-stakes names must not be the last ones a rotation lap reaches", async () => {
  sharedUniverse = ["SPY", "SPX", "AAPL"];
  openPositions = [{ ticker: "HUT" }, { ticker: "MSTR" }];
  fetchOpenSwingPositionsShouldThrow = false;

  const out = await activeVectorFullStateTickers();

  assert.deepEqual(
    out,
    ["HUT", "MSTR", "SPY", "SPX", "AAPL"],
    "open positions must lead the list a rotation cursor walks, not trail it"
  );
});

// ── rotateTickersForWarmPass — regression for the permanent-starvation bug ───────────────────
//
// Live repro (2026-10-08): with a FIXED iteration order and a per-run time budget a single
// batch can blow past, the warm cron dies on the same first ~2 tickers EVERY run, forever —
// everything after them (including a real open swing position) never gets warmed at all. A
// rotating cursor is the fix; these tests prove the rotation itself, and that enough successive
// "budget only covers K tickers" passes eventually reach every ticker — the exact invariant the
// old fixed-order loop violated.

test("rotateTickersForWarmPass starts the list at the cursor and wraps the remainder to the end", () => {
  const tickers = ["A", "B", "C", "D", "E"];
  assert.deepEqual(rotateTickersForWarmPass(tickers, 0), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(rotateTickersForWarmPass(tickers, 2), ["C", "D", "E", "A", "B"]);
  assert.deepEqual(rotateTickersForWarmPass(tickers, 4), ["E", "A", "B", "C", "D"]);
});

test("rotateTickersForWarmPass wraps a cursor past the list length instead of indexing out of range", () => {
  const tickers = ["A", "B", "C"];
  // A cursor surviving a universe that shrunk since it was last persisted must still produce a
  // valid rotation, not an empty/garbage slice.
  assert.deepEqual(rotateTickersForWarmPass(tickers, 7), rotateTickersForWarmPass(tickers, 1));
});

test("rotateTickersForWarmPass never throws on a negative or non-finite cursor", () => {
  const tickers = ["A", "B", "C"];
  assert.deepEqual(rotateTickersForWarmPass(tickers, -1), ["C", "A", "B"]);
  assert.deepEqual(rotateTickersForWarmPass(tickers, Number.NaN), tickers);
  assert.deepEqual(rotateTickersForWarmPass(tickers, Number.POSITIVE_INFINITY), tickers);
});

test("rotateTickersForWarmPass on an empty universe returns empty, never throws", () => {
  assert.deepEqual(rotateTickersForWarmPass([], 5), []);
});

test("REGRESSION: a fixed iteration order starves every ticker after the budget cutoff forever; a rotating cursor reaches all of them within N runs", () => {
  const tickers = ["SPY", "SPX", "NET", "BE", "GOOGL", "CIEN", "MSFT", "INTC"];
  const PER_RUN_BUDGET = 2; // only the first 2 tickers fit in one run's time budget, like live

  // OLD BEHAVIOR (no rotation): every run processes slice(0, budget) of the SAME fixed order.
  const everWarmedFixedOrder = new Set<string>();
  for (let run = 0; run < 10; run++) {
    for (const t of tickers.slice(0, PER_RUN_BUDGET)) everWarmedFixedOrder.add(t);
  }
  assert.deepEqual(
    everWarmedFixedOrder,
    new Set(["SPY", "SPX"]),
    "sanity check: the bug is real — 10 runs of the old fixed-order loop still only ever reach the first 2 tickers"
  );
  assert.ok(
    !everWarmedFixedOrder.has("INTC"),
    "a real open swing position (INTC) is never reached under the old fixed-order loop"
  );

  // NEW BEHAVIOR: each run rotates from where the last run's budget cutoff left off.
  let cursor = 0;
  const everWarmedRotated = new Set<string>();
  for (let run = 0; run < Math.ceil(tickers.length / PER_RUN_BUDGET); run++) {
    const ordered = rotateTickersForWarmPass(tickers, cursor);
    const attempted = ordered.slice(0, PER_RUN_BUDGET);
    for (const t of attempted) everWarmedRotated.add(t);
    cursor = (cursor + attempted.length) % tickers.length;
  }
  assert.deepEqual(
    everWarmedRotated,
    new Set(tickers),
    "every ticker — including INTC, a real open swing position far down the list — must eventually be reached"
  );
});
