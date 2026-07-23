import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screenBreakoutMovers,
  BREAKOUT_MIN_VOLUME,
  BREAKOUT_MIN_GAIN,
  BREAKOUT_MIN_CLOSE_STRENGTH,
} from "./candidates";

/** Grouped-daily bar (Polygon shape). closeStrength = (c−l)/(h−l). */
function bar(T: string, over: { o?: number; h?: number; l?: number; c?: number; v?: number } = {}) {
  return { T, o: 100, h: 112, l: 99, c: 110, v: 5_000_000, ...over };
}

test("keeps a clean breakout: +10% gain, closed strong, 5M vol", () => {
  const [m] = screenBreakoutMovers([bar("NVDA")]);
  assert.ok(m, "passes the screen");
  assert.equal(m.ticker, "NVDA");
  assert.ok(Math.abs(m.gain - 0.1) < 1e-9); // (110-100)/100
  assert.ok(m.close_strength >= BREAKOUT_MIN_CLOSE_STRENGTH);
  assert.equal(m.dollar, 110 * 5_000_000);
});

test("rejects thin volume, weak gain, weak close, and out-of-band price", () => {
  const rows = [
    bar("THIN", { v: BREAKOUT_MIN_VOLUME - 1 }), // volume too low
    bar("FLAT", { o: 100, c: 101 }), // gain 1% < 5%
    bar("FADE", { o: 100, c: 110, h: 130, l: 98 }), // closed weak: (110-98)/(130-98)=0.375 < 0.5
    bar("CHEAP", { o: 3, c: 3.3, h: 3.4, l: 2.9 }), // price < $5
    bar("PRICEY", { o: 500, c: 560, h: 565, l: 495 }), // price > $400
  ];
  assert.equal(screenBreakoutMovers(rows).length, 0);
});

test("excludes index/leveraged instruments and dotted symbols", () => {
  const rows = [bar("SPY"), bar("BRK.B"), bar("SPXL"), bar("REAL")];
  const kept = screenBreakoutMovers(rows).map((m) => m.ticker);
  assert.deepEqual(kept, ["REAL"]);
});

test("ranks by $-volume and caps at maxKeep", () => {
  // Each is a valid +~11% closed-strong breakout; only $-volume differs.
  const rows = [
    { T: "A", o: 9, h: 10.1, l: 8.9, c: 10, v: 2_000_000 }, //  $20M
    { T: "B", o: 45, h: 50.5, l: 44, c: 50, v: 3_000_000 }, // $150M
    { T: "C", o: 90, h: 101, l: 89, c: 100, v: 10_000_000 }, // $1B
  ];
  const top2 = screenBreakoutMovers(rows, 2).map((m) => m.ticker);
  assert.deepEqual(top2, ["C", "B"]); // biggest $-vol first, capped at 2
});

test("exactly-at-threshold gain passes (>= boundary)", () => {
  const [m] = screenBreakoutMovers([bar("EDGE", { o: 100, c: 100 * (1 + BREAKOUT_MIN_GAIN), h: 110, l: 99 })]);
  assert.ok(m, "a gain exactly at the floor is kept");
});

test("degenerate range (h==l) → close_strength 0, screened out", () => {
  assert.equal(screenBreakoutMovers([bar("DOJI", { o: 100, c: 110, h: 110, l: 110 })]).length, 0);
});
