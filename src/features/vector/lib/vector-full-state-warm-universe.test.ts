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
let resolveWarmCursorIndex: typeof import("./vector-full-state-warm-universe").resolveWarmCursorIndex;

before(async () => {
  ({ activeVectorFullStateTickers, rotateTickersForWarmPass, resolveWarmCursorIndex } = await import(
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

// ── resolveWarmCursorIndex — regression for the reorder/cursor-desync bug ───────────────────
//
// Live repro (2026-10-08, same day as the position-first reorder above): a raw numeric cursor
// persisted across runs is only safe while the underlying ticker list's ORDER is stable. The
// reorder fix above changes that order (positions move from tail to head) — a bare index then
// keeps meaning "skip N array slots," not "resume after ticker X," and silently points the next
// run's rotation start somewhere else entirely. These tests prove the content-addressed
// resolver does not have that failure mode.

test("resolveWarmCursorIndex resumes right after the remembered ticker in TODAY's list", () => {
  const tickers = ["HUT", "MSTR", "SPY", "SPX", "AAPL"];
  assert.equal(resolveWarmCursorIndex(tickers, "HUT"), 1);
  assert.equal(resolveWarmCursorIndex(tickers, "SPX"), 4);
  assert.equal(resolveWarmCursorIndex(tickers, "aapl"), 5, "case-insensitive, and wraps to length when it was the last entry");
});

test("resolveWarmCursorIndex falls back to 0 when there is no remembered ticker yet", () => {
  const tickers = ["HUT", "MSTR", "SPY"];
  assert.equal(resolveWarmCursorIndex(tickers, null), 0);
  assert.equal(resolveWarmCursorIndex(tickers, undefined), 0);
  assert.equal(resolveWarmCursorIndex(tickers, ""), 0);
});

test("resolveWarmCursorIndex falls back to 0 when the remembered ticker is no longer in the list", () => {
  // Position closed, or dropped from the dynamic/shared universe since the last run — restarting
  // the lap is the safe default (costs one extra partial pass over already-warm entries), not a
  // stale offset that could point anywhere once the list has moved.
  const tickers = ["HUT", "MSTR", "SPY"];
  assert.equal(resolveWarmCursorIndex(tickers, "DELISTED"), 0);
});

test("resolveWarmCursorIndex never throws on a leftover NUMBER from before this fix shipped (deploy-transition safety)", () => {
  // The FIRST read after this change deploys still returns whatever the OLD code last persisted
  // in Redis — a bare number (JSON round-trips a number as a number, not a string). Calling
  // .trim() on that unguarded would throw. A non-string input must degrade to "no remembered
  // ticker" (index 0), never crash the cron.
  const tickers = ["HUT", "MSTR", "SPY"];
  assert.equal(resolveWarmCursorIndex(tickers, 52), 0, "a leftover raw number must not throw or be treated as a ticker name");
  assert.equal(resolveWarmCursorIndex(tickers, 0), 0);
  assert.equal(resolveWarmCursorIndex(tickers, {}), 0, "an unexpected object shape must not throw either");
});

test("REGRESSION: a raw numeric cursor desyncs across a list reorder; a content-addressed one does not", () => {
  // Simulates the EXACT live incident: BEFORE the reorder, the merged universe is
  // shared-universe-first then open positions appended last. The cursor has progressed deep
  // into the list (deep into the shared-universe tail, about to reach the appended positions
  // soon). Then the SAME-DAY reorder fix ships: positions move to the FRONT. A raw index
  // cursor, replayed against the NEW order, lands somewhere in the shared-universe tail again —
  // nowhere near the positions it was supposed to finally prioritize. The ticker-name cursor,
  // replayed the same way, resumes exactly where it actually left off, content-wise.
  const sharedUniverse = ["SPY", "SPX", "NET", "BE", "GOOGL", "CIEN", "MSFT"];
  const positions = ["CIEG", "FUBO", "CRDU", "LQDA"];

  const beforeReorderList = [...sharedUniverse, ...positions]; // positions appended last (old bug)
  const afterReorderList = [...positions, ...sharedUniverse]; // positions moved first (#5709 fix)

  // The last ticker a run actually finished, under the OLD order, happened to be the very last
  // name in the shared-universe block ("MSFT") — a run about to wrap back to the start, i.e.
  // about to finally reach the appended positions next.
  const lastAttemptedTicker = "MSFT";
  const rawCursorFromOldOrder = beforeReorderList.indexOf(lastAttemptedTicker) + 1; // = 7

  // OLD BEHAVIOR (bug): the raw index (7) is blindly replayed against the NEW, reordered list.
  const staleIndexRotation = rotateTickersForWarmPass(afterReorderList, rawCursorFromOldOrder);
  assert.equal(
    staleIndexRotation[0],
    afterReorderList[7],
    "sanity check: a raw index really does just read off whatever now sits at that offset"
  );
  assert.ok(
    !positions.includes(staleIndexRotation[0]),
    "BUG: the stale raw index lands back in the shared-universe tail, not on any open position — " +
      "the exact live failure (FUBO/CRDU/LQDA still timing out minutes after the reorder deployed)"
  );

  // NEW BEHAVIOR (fix): resolve the SAME remembered ticker by content against the NEW list.
  const resolvedCursor = resolveWarmCursorIndex(afterReorderList, lastAttemptedTicker);
  const contentAddressedRotation = rotateTickersForWarmPass(afterReorderList, resolvedCursor);
  // MSFT is the very last name in the shared-universe block in BOTH orderings (positions move
  // as a block ahead of it; the shared universe's own internal order is untouched) — so a run
  // that had just finished MSFT was about to wrap back to the start of the list either way.
  // Content-addressing correctly wraps to index 0 of the NEW list — the open positions this
  // reorder exists to prioritize — instead of the stale raw index's unrelated shared-universe
  // offset above.
  assert.deepEqual(
    contentAddressedRotation.slice(0, positions.length),
    positions,
    "FIX: resuming content-addressed after MSFT wraps straight into the open positions this reorder exists to prioritize"
  );
});
