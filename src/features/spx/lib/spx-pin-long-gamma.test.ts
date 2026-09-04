import { test } from "node:test";
import assert from "node:assert/strict";
import { logReturnsFromMinuteBars } from "./spx-pin-recent-returns";
import {
  forecastPin,
  pickLongGammaMagnet,
  type PinContract,
  type PinForecastInput,
} from "./spx-pin-forecast-core";

test("logReturnsFromMinuteBars: per-minute log returns, capped", () => {
  const bars = [100, 101, 102, 101.5].map((c) => ({ c }));
  const rets = logReturnsFromMinuteBars(bars, 2);
  assert.equal(rets.length, 2);
  assert.ok(rets[1]! < 0);
});

test("pickLongGammaMagnet prefers king when nearer to spot than max pain", () => {
  const frac = (n: number | undefined) => (n && n > 0 ? n / 10000 : 0);
  const r = pickLongGammaMagnet(
    7560,
    7520,
    { strike: 7580, oi: 5000 },
    5,
    frac
  );
  assert.equal(r.magnetStrike, 7580, "king above spot should win when closer than distant max pain");
});

test("long_gamma rally: projected close can sit ABOVE spot when king clusters above", () => {
  const contracts: PinContract[] = [];
  const spot = 7555;
  for (let k = 7480; k <= 7620; k += 5) {
    const callOi = k >= 7560 && k <= 7590 ? 8000 : 400;
    const putOi = k >= 7510 && k <= 7530 ? 3000 : 350;
    contracts.push({ strike: k, expiry: "2026-09-05", type: "call", openInterest: callOi, iv: 0.11 });
    contracts.push({ strike: k, expiry: "2026-09-05", type: "put", openInterest: putOi, iv: 0.11 });
  }
  const input: PinForecastInput = {
    spot,
    priorClose: 7520,
    contracts,
    sessionYmd: "2026-09-05",
    nowMs: Date.parse("2026-09-05T18:30:00Z"),
    closeMs: Date.parse("2026-09-05T20:00:00Z"),
    atmIv: 0.11,
    seed: 11,
  };
  const f = forecastPin(input);
  assert.equal(f.available, true);
  assert.equal(f.regime, "long_gamma");
  assert.ok(
    (f.projectedClose ?? 0) > spot,
    `projectedClose ${f.projectedClose} should project ABOVE spot ${spot} when OI king sits above`
  );
  assert.ok(
    (f.pinDriftPts ?? 0) > 0,
    `pinDriftPts ${f.pinDriftPts} must read upward vs spot`
  );
});

test("pinDriftPts tracks projectedClose minus spot", () => {
  const contracts: PinContract[] = [];
  for (let k = 7300; k <= 7700; k += 5) {
    const callOi = 500 + (k === 7600 ? 5000 : 0);
    const putOi = 450 + (k === 7450 ? 4000 : 0);
    contracts.push({ strike: k, expiry: "2026-07-21", openInterest: callOi, iv: 0.12, type: "call" });
    contracts.push({ strike: k, expiry: "2026-07-21", openInterest: putOi, iv: 0.12, type: "put" });
  }
  const f = forecastPin({
    spot: 7507.6,
    priorClose: 7443.28,
    contracts,
    sessionYmd: "2026-07-21",
    nowMs: Date.parse("2026-07-21T17:04:00Z"),
    closeMs: Date.parse("2026-07-21T20:00:00Z"),
    atmIv: 0.12,
    seed: 42,
  });
  assert.ok(f.pinDriftPts != null);
  assert.ok(Math.abs(f.pinDriftPts! - ((f.projectedClose ?? 0) - f.spot)) < 0.02);
});
