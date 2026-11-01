import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketRegime } from "./market-regime";

function bars(closes: number[]): Array<{ o: number; h: number; l: number; c: number; t?: number }> {
  return closes.map((c, i) => ({ o: c, h: c, l: c, c, t: i }));
}

const NO_GAP = null;
const NO_EVENTS: Record<string, unknown>[] = [];

test("classifyMarketRegime: trend/volatility honestly null with too little history", () => {
  const result = classifyMarketRegime({
    spx_bars: bars([100, 101, 102]), // < 20 bars
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: NO_EVENTS,
  });
  assert.equal(result.trend, null);
  assert.equal(result.spx_sma20, null);
  assert.equal(result.volatility, null);
  assert.equal(result.vix_close, null);
});

test("classifyMarketRegime: SPX meaningfully above its own SMA20 reads UP", () => {
  const closes = Array.from({ length: 20 }, () => 100); // flat baseline
  closes.push(110); // last close well above the trailing-20 SMA (which now includes it: 100.5)
  const result = classifyMarketRegime({
    spx_bars: bars(closes),
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: NO_EVENTS,
  });
  assert.equal(result.spx_sma20, 100.5); // trailing 20 of 21 bars: 19x100 + 1x110
  assert.equal(result.spx_close, 110);
  assert.equal(result.trend, "up");
});

test("classifyMarketRegime: SPX meaningfully below its own SMA20 reads DOWN", () => {
  const closes = Array.from({ length: 20 }, () => 100);
  closes.push(90);
  const result = classifyMarketRegime({
    spx_bars: bars(closes),
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: NO_EVENTS,
  });
  assert.equal(result.trend, "down");
});

test("classifyMarketRegime: a move inside the +/-0.5% band reads NEUTRAL, not a flip", () => {
  const closes = Array.from({ length: 20 }, () => 100);
  closes.push(100.2); // 0.2% above SMA20 -- inside the band
  const result = classifyMarketRegime({
    spx_bars: bars(closes),
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: NO_EVENTS,
  });
  assert.equal(result.trend, "neutral");
});

test("classifyMarketRegime: VIX buckets into low/normal/high on the documented bands", () => {
  const low = classifyMarketRegime({ spx_bars: [], vix_bars: bars([14]), spx_gap: NO_GAP, macro_events: NO_EVENTS });
  const normal = classifyMarketRegime({ spx_bars: [], vix_bars: bars([20]), spx_gap: NO_GAP, macro_events: NO_EVENTS });
  const high = classifyMarketRegime({ spx_bars: [], vix_bars: bars([30]), spx_gap: NO_GAP, macro_events: NO_EVENTS });
  assert.equal(low.volatility, "low");
  assert.equal(normal.volatility, "normal");
  assert.equal(high.volatility, "high");
});

test("classifyMarketRegime: passes the already-computed SpxGapContext straight through, no re-derivation", () => {
  const result = classifyMarketRegime({
    spx_bars: [],
    vix_bars: [],
    spx_gap: {
      prior_close: 100,
      session_open: 102,
      last_price: 103,
      gap_pct: 2,
      pattern: "gap_and_go",
      detail: "irrelevant here",
    },
    macro_events: NO_EVENTS,
  });
  assert.equal(result.gap_pattern, "gap_and_go");
  assert.equal(result.gap_pct, 2);
});

test("classifyMarketRegime: null spx_gap leaves gap fields honestly null, not fabricated flat", () => {
  const result = classifyMarketRegime({ spx_bars: [], vix_bars: [], spx_gap: NO_GAP, macro_events: NO_EVENTS });
  assert.equal(result.gap_pattern, null);
  assert.equal(result.gap_pct, null);
});

test("classifyMarketRegime: event_day is true iff macro_events is non-empty", () => {
  const noEvents = classifyMarketRegime({ spx_bars: [], vix_bars: [], spx_gap: NO_GAP, macro_events: [] });
  const withEvents = classifyMarketRegime({
    spx_bars: [],
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: [{ title: "FOMC" }],
  });
  assert.equal(noEvents.event_day, false);
  assert.equal(withEvents.event_day, true);
});

test("classifyMarketRegime: a non-finite/zero close in the tape is skipped, not treated as the latest print", () => {
  const closes = Array.from({ length: 20 }, () => 100);
  const barsWithBadTail = bars(closes);
  barsWithBadTail.push({ o: 0, h: 0, l: 0, c: 0, t: 999 }); // a bad trailing bar
  const result = classifyMarketRegime({
    spx_bars: barsWithBadTail,
    vix_bars: [],
    spx_gap: NO_GAP,
    macro_events: NO_EVENTS,
  });
  assert.equal(result.spx_close, 100); // the last GOOD close, not the zero
});
