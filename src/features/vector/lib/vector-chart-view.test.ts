import test from "node:test";
import assert from "node:assert/strict";
import { defaultVisibleBars, initialLogicalRange } from "./vector-chart-view";
import { VECTOR_DAILY_UNITS } from "./vector-daily-bars";

test("the view strings match the real unit union", () => {
  // The first version of this file used "day"/"week" — strings that do not exist in
  // VectorDailyUnit ("1D" | "1W"). Every assertion still passed, because the test shared the
  // bug: defaultVisibleBars fell through to the 1D default for a value it should never receive.
  // tsc caught it, the test could not. Pin the union so it cannot drift back.
  assert.deepEqual([...VECTOR_DAILY_UNITS], ["1D", "1W"]);
});

test("each historical view frames a legible number of candles", () => {
  // The bug: fitContent() put ~500 daily bars in ~900px (~1.8px/candle). These counts target
  // 8-12px/candle. Asserting the BAND, not the exact number, so tuning stays possible without a
  // meaningless test edit — but a regression back toward "show everything" fails.
  for (const unit of ["1D", "1W", "4H"] as const) {
    const n = defaultVisibleBars(unit);
    assert.ok(n >= 60 && n <= 140, `${unit} frames ${n} bars — outside the legible band`);
  }
  // 4H bars are ~6/day, so it needs the most bars to cover a useful span.
  assert.ok(defaultVisibleBars("4H") > defaultVisibleBars("1W"));
});

test("the initial range shows the most RECENT bars, not the oldest", () => {
  const r = initialLogicalRange(500, "1D");
  assert.ok(r);
  assert.equal(r.from, 500 - 90);
  // `to` sits one bar past the end so the newest candle is not flush against the right edge,
  // where its wick reads ambiguously.
  assert.equal(r.to, 501);
  assert.ok(r.to > 500, "newest candle must have breathing room at the right edge");
});

test("short histories fall back to fitContent instead of pinning dead space", () => {
  // Pinning a 90-bar window over 40 bars of data would render ~50 bars of emptiness on the left.
  assert.equal(initialLogicalRange(40, "1D"), null);
  assert.equal(initialLogicalRange(90, "1D"), null, "exactly the window size still fits");
  assert.notEqual(initialLogicalRange(91, "1D"), null);
});

test("degenerate bar counts never produce a range", () => {
  for (const n of [0, -1, NaN, Infinity]) {
    assert.equal(initialLogicalRange(n as number, "1D"), null, `barCount=${n}`);
  }
});
