import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smaSeries,
  emaSeries,
  vwapSeries,
  rsiSeries,
  macdSeries,
} from "./vector-indicators";

const approx = (a: number | null, b: number, eps = 1e-6) => {
  assert.ok(a != null && Math.abs(a - b) < eps, `expected ~${b}, got ${a}`);
};

test("smaSeries: trailing mean, null in the warm-up region", () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  // period longer than the series → all null; period<=0 → all null.
  assert.deepEqual(smaSeries([1, 2], 5), [null, null]);
  assert.deepEqual(smaSeries([1, 2, 3], 0), [null, null, null]);
});

test("emaSeries: SMA seed then k=2/(period+1) recursion", () => {
  // period 3 (k=0.5), seed = mean(1,2,3)=2 at idx2; idx3 = 10*0.5 + 2*0.5 = 6.
  const out = emaSeries([1, 2, 3, 10], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  approx(out[2], 2);
  approx(out[3], 6);
});

test("vwapSeries: session-cumulative typical×volume; null before any volume", () => {
  const bars = [
    { high: 10, low: 10, close: 10, volume: 100 }, // typical 10
    { high: 20, low: 20, close: 20, volume: 300 }, // typical 20
  ];
  const out = vwapSeries(bars);
  approx(out[0], 10);
  approx(out[1], (10 * 100 + 20 * 300) / 400); // 17.5
});

test("vwapSeries: RESETS at ET session boundary — multi-day bars must not blend into one VWAP", () => {
  // Regression for the desk/terminal VWAP mismatch (2026-07-13): the multi-day chart seed fed
  // 3 sessions into one accumulation, so the terminal read a 3-day VWAP (7,542.28) while the
  // desk's session VWAP read 7,529.98. Day 2's VWAP must be computed from day-2 bars ONLY.
  const d1 = 1783949400; // 2026-07-13 09:30 ET (epoch s)
  const d2 = d1 + 24 * 3600; // next ET day
  const bars = [
    { time: d1, high: 10, low: 10, close: 10, volume: 100 },
    { time: d1 + 60, high: 20, low: 20, close: 20, volume: 300 },
    { time: d2, high: 50, low: 50, close: 50, volume: 100 }, // new session → reset
    { time: d2 + 60, high: 60, low: 60, close: 60, volume: 100 },
  ];
  const out = vwapSeries(bars);
  approx(out[1], 17.5); // day-1 unchanged
  approx(out[2], 50); // NOT (10*100+20*300+50*100)/500 = 24 — day-1 must not leak in
  approx(out[3], 55);
});

test("vwapSeries: same-ET-day bars do NOT reset (intraday accumulation preserved)", () => {
  const t0 = 1783949400; // 09:30 ET
  const bars = [
    { time: t0, high: 10, low: 10, close: 10, volume: 100 },
    { time: t0 + 6.5 * 3600 - 60, high: 20, low: 20, close: 20, volume: 300 }, // 15:59 ET same day
  ];
  approx(vwapSeries(bars)[1], 17.5);
});

test("vwapSeries: premarket/after-hours bars do NOT anchor session VWAP (2026-08-05 audit fix)", () => {
  const t0 = 1783949400; // 2026-07-13 09:30 ET (RTH open)
  const premarket = t0 - 5.5 * 3600; // 04:00 ET same day
  const afterHours = t0 + 6.5 * 3600 + 2 * 3600; // 18:00 ET same day
  const bars = [
    { time: premarket, high: 1000, low: 1000, close: 1000, volume: 99999 }, // must be ignored
    { time: t0, high: 10, low: 10, close: 10, volume: 100 }, // 09:30 RTH open
    { time: t0 + 60, high: 20, low: 20, close: 20, volume: 300 },
    { time: afterHours, high: 5000, low: 5000, close: 5000, volume: 99999 }, // must be ignored
  ];
  const out = vwapSeries(bars);
  // The premarket bar's huge volume/price must not enter the accumulation at all.
  assert.equal(out[0], null, "premarket bar contributes no volume, so VWAP is still undefined");
  approx(out[1], 10); // RTH open anchors VWAP fresh, at its own typical price
  approx(out[2], (10 * 100 + 20 * 300) / 400); // 17.5 — same as the plain RTH-only case
  // After-hours: VWAP flat-lines at the last RTH value rather than being dragged toward 5000.
  approx(out[3], 17.5);
});

test("vwapSeries: bars without time keep legacy continuous accumulation", () => {
  const bars = [
    { high: 10, low: 10, close: 10, volume: 100 },
    { high: 20, low: 20, close: 20, volume: 300 },
  ];
  approx(vwapSeries(bars)[1], 17.5);
});

test("vwapSeries: no volume anywhere → null (never substituted with price)", () => {
  const bars = [
    { high: 10, low: 9, close: 9.5 },
    { high: 11, low: 10, close: 10.5, volume: 0 },
  ];
  assert.deepEqual(vwapSeries(bars), [null, null]);
});

test("rsiSeries: too-short → null; all-gains → 100; all-losses → 0", () => {
  assert.deepEqual(rsiSeries([1, 2, 3], 14), [null, null, null]);
  const up = Array.from({ length: 20 }, (_, i) => i + 1); // strictly increasing
  assert.equal(rsiSeries(up, 14).at(-1), 100);
  const down = Array.from({ length: 20 }, (_, i) => 20 - i); // strictly decreasing
  assert.equal(rsiSeries(down, 14).at(-1), 0);
});

test("rsiSeries: Wilder smoothing matches a hand-computed period-2 case", () => {
  // closes [1,3,2,4], deltas +2,-1,+2, period 2.
  // idx2: avgGain=1, avgLoss=0.5 → RS=2 → 66.667; idx3: avgGain=1.5, avgLoss=0.25 → RS=6 → 85.714.
  const out = rsiSeries([1, 3, 2, 4], 2);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  approx(out[2], 100 - 100 / 3, 1e-4);
  approx(out[3], 100 - 100 / 7, 1e-4);
});

test("macdSeries: constant closes → macd/signal/histogram all 0 where defined", () => {
  const closes = new Array(40).fill(100);
  const out = macdSeries(closes, 12, 26, 9);
  // Warm-up: macd null before the slow EMA seed (index 25).
  assert.equal(out[24]!.macd, null);
  approx(out[25]!.macd, 0);
  // Signal defined 9 macd-points later (index 33); histogram = macd - signal = 0.
  assert.equal(out[32]!.signal, null);
  approx(out[33]!.signal, 0);
  approx(out[33]!.histogram, 0);
});

test("macdSeries: histogram === macd - signal wherever both are defined (ramp)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 1.5 + Math.sin(i) * 3);
  const out = macdSeries(closes, 12, 26, 9);
  let checked = 0;
  for (const p of out) {
    if (p.macd != null && p.signal != null) {
      approx(p.histogram, p.macd - p.signal, 1e-9);
      checked++;
    }
    // histogram is defined exactly when signal is.
    assert.equal(p.histogram != null, p.signal != null);
  }
  assert.ok(checked > 10, "several defined points exercised");
});
