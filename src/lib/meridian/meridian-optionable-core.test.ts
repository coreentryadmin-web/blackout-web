import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOptionableSymbol,
  buildOptionableIndex,
  partitionOptionable,
} from "./meridian-optionable-core";

/** A realistic index: big enough to pass the min-size guard. */
const bigIndex = (extra: string[] = []) =>
  buildOptionableIndex([...Array.from({ length: 200 }, (_, i) => `T${i}`), ...extra]);

test("normalizeOptionableSymbol: class-share separators are stripped", () => {
  // The whole reason this module exists: UW writes BRKB, Benzinga writes BRK.B.
  assert.equal(normalizeOptionableSymbol("BRK.B"), "BRKB");
  assert.equal(normalizeOptionableSymbol("BRK/B"), "BRKB");
  assert.equal(normalizeOptionableSymbol("brkb"), "BRKB");
  assert.equal(normalizeOptionableSymbol(" NVDA "), "NVDA");
});

test("normalizeOptionableSymbol: junk normalizes to empty, not to a match-all", () => {
  assert.equal(normalizeOptionableSymbol(null), "");
  assert.equal(normalizeOptionableSymbol(undefined), "");
  assert.equal(normalizeOptionableSymbol("..."), "");
});

test("buildOptionableIndex: accepts bare strings and object rows alike", () => {
  const idx = buildOptionableIndex(["NVDA", { ticker: "BRK.B" }, { symbol: "SPY" }, "", null as never]);
  assert.deepEqual([...idx].sort(), ["BRKB", "NVDA", "SPY"]);
});

test("partitionOptionable: dotted class shares are KEPT when the index holds the stripped form", () => {
  // This is the live failure a plain includes() would have produced — BRK.B silently dropped.
  const idx = bigIndex(["BRKB", "NVDA"]);
  const rows = [{ ticker: "BRK.B" }, { ticker: "NVDA" }, { ticker: "ZZZZ" }];
  const out = partitionOptionable(rows, idx, (r) => r.ticker);
  assert.deepEqual(out.kept.map((r) => r.ticker), ["BRK.B", "NVDA"]);
  assert.deepEqual(out.hidden.map((r) => r.ticker), ["ZZZZ"]);
  assert.equal(out.applied, true);
});

test("partitionOptionable: FAILS OPEN on a missing index — an empty lane would be a lie", () => {
  const rows = [{ ticker: "AAA" }, { ticker: "BBB" }];
  for (const idx of [null, undefined, new Set<string>()]) {
    const out = partitionOptionable(rows, idx, (r) => r.ticker);
    assert.equal(out.kept.length, 2, "everything is kept when the filter cannot run");
    assert.equal(out.hidden.length, 0);
    assert.equal(out.applied, false, "callers must be able to tell 'did not run' from 'nothing hidden'");
  }
});

test("partitionOptionable: a suspiciously small index is treated as unusable", () => {
  // A truncated or half-parsed response would otherwise empty a 360-row earnings lane.
  const tiny = buildOptionableIndex(["NVDA", "SPY"]);
  const out = partitionOptionable([{ ticker: "AAPL" }], tiny, (r) => r.ticker);
  assert.equal(out.applied, false);
  assert.equal(out.kept.length, 1);
});

test("partitionOptionable: an unreadable ticker is kept, never silently dropped", () => {
  const idx = bigIndex(["NVDA"]);
  const rows = [{ ticker: null }, { ticker: "" }, { ticker: "NVDA" }, { ticker: "ZZZZ" }];
  const out = partitionOptionable(rows, idx, (r) => r.ticker);
  assert.equal(out.kept.length, 3, "rows we failed to parse stay visible");
  assert.deepEqual(out.hidden.map((r) => r.ticker), ["ZZZZ"]);
});

test("partitionOptionable: nothing hidden and filter-not-run are distinguishable", () => {
  const idx = bigIndex(["NVDA"]);
  const ran = partitionOptionable([{ ticker: "NVDA" }], idx, (r) => r.ticker);
  assert.equal(ran.applied, true);
  assert.equal(ran.hidden.length, 0);

  const didNot = partitionOptionable([{ ticker: "NVDA" }], null, (r) => r.ticker);
  assert.equal(didNot.applied, false);
  assert.equal(didNot.hidden.length, 0);
});

test("partitionOptionable: input order is preserved within each bucket", () => {
  const idx = bigIndex(["AAA", "CCC"]);
  const rows = [{ ticker: "AAA" }, { ticker: "BBB" }, { ticker: "CCC" }, { ticker: "DDD" }];
  const out = partitionOptionable(rows, idx, (r) => r.ticker);
  assert.deepEqual(out.kept.map((r) => r.ticker), ["AAA", "CCC"]);
  assert.deepEqual(out.hidden.map((r) => r.ticker), ["BBB", "DDD"]);
});
