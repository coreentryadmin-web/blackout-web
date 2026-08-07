import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { roundFloats } from "@/lib/round-floats";
import { computeExpectedMove } from "./vector-expected-move";
import { VECTOR_FRACTION_DP } from "./vector-response-rounding";

// These fixtures are the ACTUAL live production values captured at 09:47 ET on 2026-08-07 — the
// reads that exposed the bug. Reproducing the defect from the real numbers (rather than a synthetic
// 0.004) is what makes this a regression test rather than a restatement of the fix.
const LIVE = [
  { ticker: "SPX", spot: 7737.83, atmIv: 0.15, dteDays: 0.26, expectPts: 31 },
  { ticker: "NVDA", spot: 222.06, atmIv: 0.46, dteDays: 0.26, expectPts: 2.71 },
  { ticker: "ASTS", spot: 69.78, atmIv: 1.36, dteDays: 0.26, expectPts: 2.55 },
] as const;

test("REGRESSION: the blanket 2dp default quantizes SPX's movePct to a literal zero", () => {
  // The pre-fix behaviour, pinned so nobody "simplifies" the keyDp away without seeing what returns.
  const em = computeExpectedMove({ spot: 7737.83, atmIv: 0.15, dteDays: 0.26 });
  assert.ok(em, "precondition: the live SPX inputs must produce a band");
  assert.ok(em.movePct > 0.003 && em.movePct < 0.005, `precondition: true movePct ~0.004, got ${em.movePct}`);

  const naive = roundFloats({ expectedMove: em });
  assert.equal(naive.expectedMove.movePct, 0, "pre-fix: 2dp floors a 0.4% move to 0.00%");
});

test("the fraction overrides preserve movePct and atmIv on every live ticker", () => {
  for (const f of LIVE) {
    const em = computeExpectedMove({ spot: f.spot, atmIv: f.atmIv, dteDays: f.dteDays });
    assert.ok(em, `${f.ticker}: expected a band`);

    const served = roundFloats({ expectedMove: em }, 2, VECTOR_FRACTION_DP);
    // Within half a step of the 6dp grid — i.e. the number survived, it was not quantized.
    assert.ok(
      Math.abs(served.expectedMove.movePct - em.movePct) <= 5e-7,
      `${f.ticker}: movePct ${em.movePct} was destroyed -> ${served.expectedMove.movePct}`
    );
    // The headline a renderer actually prints: movePct * 100 must agree with movePts / spot * 100.
    const fromPts = (em.bands[0]!.movePts / f.spot) * 100;
    assert.ok(
      Math.abs(served.expectedMove.movePct * 100 - fromPts) < 0.01,
      `${f.ticker}: served ${(served.expectedMove.movePct * 100).toFixed(4)}% contradicts ±${em.bands[0]!.movePts.toFixed(2)} pts (${fromPts.toFixed(4)}%)`
    );
    assert.equal(served.expectedMove.atmIv, f.atmIv, `${f.ticker}: atmIv must survive the boundary`);
  }
});

test("dollar-scale siblings still take the 2dp default — the override is surgical, not global", () => {
  const served = roundFloats(
    { expectedMove: { spot: 7737.834999, movePct: 0.004006123, bands: [{ sigma: 1, movePts: 31.004999, low: 7706.825001, high: 7768.844999 }] } },
    2,
    VECTOR_FRACTION_DP
  );
  assert.equal(served.expectedMove.spot, 7737.83);
  assert.equal(served.expectedMove.bands[0]!.movePts, 31);
  assert.equal(served.expectedMove.bands[0]!.low, 7706.83);
  assert.equal(served.expectedMove.bands[0]!.high, 7768.84);
});

test("pin-forecast 0..1 fields keep the precision the core deliberately emitted", () => {
  // spx-pin-forecast-core emits pinPct/strengthPct at toFixed(3); 2dp at the boundary threw the
  // third digit away, and a sub-1% scenario probability became a flat 0 ("cannot happen").
  const forecast = {
    pinPct: 0.923,
    magnet: { strike: 207.5, strengthPct: 0.234 },
    scenarios: [{ close: 205, p: 0.6123 }, { close: 240, p: 0.0041 }],
    drivers: [{ label: "max pain", weight: 0.375 }],
    spot: 222.059999,
  };
  const served = roundFloats({ forecast }, 2, VECTOR_FRACTION_DP);
  assert.equal(served.forecast.pinPct, 0.923);
  assert.equal(served.forecast.magnet.strengthPct, 0.234);
  assert.equal(served.forecast.scenarios[1]!.p, 0.0041, "a 0.41% tail must not round to impossible");
  assert.equal(served.forecast.drivers[0]!.weight, 0.375);
  assert.equal(served.forecast.spot, 222.06, "prices still take the 2dp default");
});

test("/api/market/vector/bars rounds at the response boundary like every sibling read", () => {
  // It served `7788.650000000001` live on 2026-08-07. Source-pinned because the handler needs live
  // providers to exercise; the behaviour it guards is asserted functionally below.
  const src = readFileSync("src/app/api/market/vector/bars/route.ts", "utf8");
  assert.match(src, /roundFloats\(\{ ticker, sessionYmd, bars/);
});

test("bar OHLC noise is cleaned while epoch time and volume pass through untouched", () => {
  const served = roundFloats({
    bars: [{ time: 1786109400, open: 7788.649999999998, high: 7788.650000000001, low: 7780.11, close: 7784.5, volume: 1234567 }],
  });
  const bar = served.bars[0]!;
  assert.equal(bar.high, 7788.65);
  assert.equal(bar.open, 7788.65);
  assert.equal(bar.time, 1786109400, "epoch seconds are integers and must be bit-identical");
  assert.equal(bar.volume, 1234567);
});
