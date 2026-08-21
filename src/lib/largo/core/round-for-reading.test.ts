import { test } from "node:test";
import assert from "node:assert/strict";

import { roundNumberForReading, roundResultForReading } from "./round-for-reading";

test("the real malformed values from the live scan are cleaned up", () => {
  // Every one of these was measured in a tool result on 2026-08-20.
  assert.equal(roundNumberForReading(4276339.059400001), 4276339.0594); // get_dark_pool total_premium
  assert.equal(roundNumberForReading(7707.9800000000005), 7707.98); // I:SPX daily close
  assert.equal(roundNumberForReading(7499.360000000001), 7499.36); // the long-standing repo example
  assert.equal(roundNumberForReading(-53203.84586855752), -53203.8459); // call_gamma_oi
  assert.equal(roundNumberForReading(45756696.40909090909), 45756696.4091); // avg30_stock_volume
});

test("greeks keep meaning — significant digits below 1, not a fixed decimal count", () => {
  assert.equal(roundNumberForReading(0.9160819881475173), 0.916082);
  assert.equal(roundNumberForReading(0.18201775271937676), 0.182018);
  assert.equal(roundNumberForReading(0.022560723076101536), 0.0225607);
  assert.equal(roundNumberForReading(-0.21059919274903996), -0.210599);
  // The reason it is significant digits: a fixed 4dp would turn this real gamma into 0.
  const tinyGamma = 0.0000123456789;
  assert.equal(roundNumberForReading(tinyGamma), 0.0000123457);
  assert.notEqual(roundNumberForReading(tinyGamma), 0);
});

test("integers are never touched — strikes, OI, share counts, epochs", () => {
  for (const n of [0, 1, 7640, -250, 1787202000000, 12_400_000]) {
    assert.equal(roundNumberForReading(n), n);
  }
});

test("non-finite numbers pass through rather than becoming a plausible value", () => {
  assert.ok(Number.isNaN(roundNumberForReading(NaN)));
  assert.equal(roundNumberForReading(Infinity), Infinity);
});

test("UW's numeric strings are rounded but stay strings", () => {
  const uw = { data: [{ ticker: "SPX", price: "7705", gamma: "3865614809.8123456789" }] };
  const out = roundResultForReading(uw);
  assert.equal(out.data[0].ticker, "SPX");
  assert.equal(out.data[0].price, "7705", "an integer string is unchanged");
  assert.equal(typeof out.data[0].gamma, "string", "the type must not shift under consumers");
  assert.equal(out.data[0].gamma, "3865614809.8123");
});

test("a string that only LOOKS numeric-adjacent is left completely alone", () => {
  const out = roundResultForReading({
    session_date: "2026-08-20",
    et: "2026-08-20 10:30 ET",
    ticker: "SPX",
    note: "7499.360000000001 was served here",
    quoted: "7.10",
  });
  assert.equal(out.session_date, "2026-08-20");
  assert.equal(out.et, "2026-08-20 10:30 ET");
  assert.equal(out.note, "7499.360000000001 was served here", "prose is not a number");
  assert.equal(out.quoted, "7.10", "an unchanged value keeps its original text, trailing zero included");
});

test("structure is preserved exactly — only precision changes", () => {
  const before = {
    results: [
      { t: 1787202000000, c: 7707.9800000000005, session_date: "2026-08-19", v: null },
      { t: 1787288400000, c: 7641.16, session_date: "2026-08-20", v: undefined },
    ],
    nested: { deep: { arr: [1.00000000001, "x", true] } },
    ok: true,
  };
  const after = roundResultForReading(before);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.equal(after.results.length, 2);
  assert.equal(after.results[0].c, 7707.98);
  assert.equal(after.results[0].session_date, "2026-08-19");
  assert.equal(after.results[0].v, null);
  assert.equal(after.results[1].c, 7641.16, "an already-clean value is untouched");
  assert.deepEqual(after.nested.deep.arr, [1, "x", true]);
  assert.equal(after.ok, true);
  assert.notEqual(after, before, "the input must not be mutated");
  assert.equal(before.results[0].c, 7707.9800000000005, "the original is left intact");
});

test("what it cannot safely round, it must not damage", () => {
  // A cycle must terminate rather than blow the stack.
  const cyclic: Record<string, unknown> = { px: 1.00000000001 };
  cyclic.self = cyclic;
  const out = roundResultForReading(cyclic) as Record<string, unknown>;
  assert.equal(out.px, 1);

  // A class instance keeps its identity — rebuilding it as a bare object would lose behaviour.
  const d = new Date(1787202000000);
  const withDate = roundResultForReading({ when: d, px: 1.00000000001 });
  assert.equal(withDate.when, d);
  assert.equal(withDate.px, 1);
});
