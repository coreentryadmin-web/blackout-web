import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultVisibleBars,
  initialLogicalRange,
  isIndexTicker,
  nearestStrike,
  readPersisted,
  writePersisted,
  zoomPresetBars,
} from "./vector-chart-view";
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

test("zoom presets scale with each view's bar cadence", () => {
  // Same calendar span, different bar counts — 4H has ~6 bars/session, 1W has ~4.33/month.
  assert.equal(zoomPresetBars("3M", "1D"), 63);
  assert.equal(zoomPresetBars("3M", "1W"), 13);
  assert.equal(zoomPresetBars("3M", "4H"), 378);
  // Monotonic in span, per view.
  for (const unit of ["1D", "1W", "4H"] as const) {
    const three = zoomPresetBars("3M", unit)!;
    const six = zoomPresetBars("6M", unit)!;
    const year = zoomPresetBars("1Y", unit)!;
    assert.ok(three < six && six < year, `${unit} presets not monotonic`);
  }
  assert.equal(zoomPresetBars("ALL", "1D"), null, "ALL means fitContent, not a bar count");
});

test("indices are known to have no volume", () => {
  for (const t of ["SPX", "spx", "I:SPX", "NDX", "VIX", "RUT"]) {
    assert.equal(isIndexTicker(t), true, t);
  }
  // Equities and ETFs DO have volume — misclassifying one would suppress a real histogram.
  for (const t of ["SPY", "QQQ", "NVDA", "AAPL", "IWM"]) {
    assert.equal(isIndexTicker(t), false, t);
  }
});

test("persisted choices reject values outside the allowed set", () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    assert.equal(readPersisted("k", ["1D", "1W"] as const, "1D"), "1D", "unset falls back");
    writePersisted("k", "1W");
    assert.equal(readPersisted("k", ["1D", "1W"] as const, "1D"), "1W");
    // A stale value from an older build must not put the chart into an invalid state.
    writePersisted("k", "week");
    assert.equal(readPersisted("k", ["1D", "1W"] as const, "1D"), "1D");
  } finally {
    g.localStorage = prev;
  }
});

test("storage failures never throw into the render path", () => {
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  // Safari private mode throws on both read and write.
  g.localStorage = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceeded"); },
  };
  try {
    assert.equal(readPersisted("k", ["1D"] as const, "1D"), "1D");
    assert.doesNotThrow(() => writePersisted("k", "1D"));
  } finally {
    g.localStorage = prev;
  }
});

test("crosshair maps to the nearest strike, or to nothing", () => {
  const strikes = [7800, 7775, 7750, 7725, 7700];
  assert.equal(nearestStrike(7752, strikes), 7750);
  assert.equal(nearestStrike(7787, strikes), 7775, "ties toward the first-seen on equal distance");
  // Tolerance is a FRACTION of price so it works at SPX ~7,700 and on a $3 stock alike.
  // 7900 is 100 away from 7800 = 1.3% > 0.4% default → no highlight.
  assert.equal(nearestStrike(7900, strikes), null, "too far — highlight nothing rather than snap");
  assert.equal(nearestStrike(3.01, [3, 3.5, 4]), 3, "cheap underlyings still resolve");
  // Degenerate inputs must not highlight a strike.
  assert.equal(nearestStrike(null, strikes), null);
  assert.equal(nearestStrike(NaN, strikes), null);
  assert.equal(nearestStrike(0, strikes), null);
  assert.equal(nearestStrike(7750, []), null);
  assert.equal(nearestStrike(7750, [NaN, Infinity] as number[]), null, "non-finite strikes ignored");
});
