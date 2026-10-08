import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPrint,
  identityKey,
  HUGE_PREMIUM_FLOOR,
  isHugeSweep,
  isHugeBlock,
  repeatedClassification,
  trendAlignment,
  forwardUnderlyingReturn,
  optionReturnProxy,
  chooseBucketCount,
  bucketByVariableQuantile,
  bucketedMetricVerdict,
  baselineSummary,
} from "./helix-sweep-eval.mjs";

function fakeFlow(overrides = {}) {
  return {
    ticker: "nvda",
    option_type: "CALL",
    strike: 150,
    expiry: "2026-10-16",
    alerted_at: "2026-09-20T14:30:00Z",
    premium: 1_200_000,
    has_sweep: true,
    trade_count: 4,
    alert_rule: "RepeatedHits",
    ...overrides,
  };
}

function fakeRaw(overrides = {}) {
  return {
    created_at: "2026-09-20T14:30:00Z",
    has_sweep: true,
    has_floor: false,
    total_premium: "1200000",
    delta: 0.45,
    theta: -0.08,
    underlying_price: "148.2",
    price: "3.5",
    volume: "5000",
    open_interest: "2000",
    volume_oi_ratio: "2.5",
    trade_count: 4,
    total_ask_side_prem: "1000000",
    total_bid_side_prem: "200000",
    ...overrides,
  };
}

test("classifyPrint: reduces a raw+parsed pair into the exact pre-signal fields, uppercases ticker, derives dte", () => {
  const p = classifyPrint(fakeFlow(), fakeRaw());
  assert.equal(p.ticker, "NVDA");
  assert.equal(p.side, "call");
  assert.equal(p.premium, 1_200_000);
  assert.equal(p.isSweep, true);
  assert.equal(p.isFloor, false);
  assert.equal(p.delta, 0.45);
  assert.equal(p.deltaAbs, 0.45);
  assert.equal(p.theta, -0.08);
  assert.equal(p.underlyingPriceAtAlert, 148.2);
  assert.equal(p.entryOptionPrice, 3.5);
  assert.equal(p.volume, 5000);
  assert.equal(p.openInterest, 2000);
  assert.equal(p.volumeOiRatio, 2.5);
  assert.equal(p.tradeCount, 4);
  assert.equal(p.sideDirection, "bull");
  assert.equal(p.dte, 25); // 2026-09-20T14:30Z -> 2026-10-16T00:00Z, rounded (not a whole-day boundary)
  assert.equal(p.alertRule, "RepeatedHits");
});

test("classifyPrint: otmPct/otmPctAbs are delta-free (computed from strike vs spot), positive = OTM, side-aware sign", () => {
  // Call, strike 150 > spot 148.2 -> OTM -> positive.
  const otmCall = classifyPrint(fakeFlow({ option_type: "CALL", strike: 150 }), fakeRaw({ underlying_price: "148.2" }));
  assert.ok(otmCall.otmPct > 0);
  assert.ok(Math.abs(otmCall.otmPct - ((150 - 148.2) / 148.2) * 100) < 1e-9);
  assert.equal(otmCall.otmPctAbs, Math.abs(otmCall.otmPct));

  // Call, strike 140 < spot 148.2 -> ITM -> negative.
  const itmCall = classifyPrint(fakeFlow({ option_type: "CALL", strike: 140 }), fakeRaw({ underlying_price: "148.2" }));
  assert.ok(itmCall.otmPct < 0);

  // Put, strike 140 < spot 148.2 -> OTM -> positive (side-aware sign flips vs call).
  const otmPut = classifyPrint(fakeFlow({ option_type: "PUT", strike: 140 }), fakeRaw({ underlying_price: "148.2" }));
  assert.ok(otmPut.otmPct > 0);

  // No delta needed for this field — still populated even when raw.delta is null (the exact
  // real-world case this exists for: UW only carries live greeks ~3 days back).
  const noDelta = classifyPrint(fakeFlow(), fakeRaw({ delta: null, theta: null }));
  assert.equal(noDelta.delta, null);
  assert.equal(noDelta.deltaAbs, null);
  assert.ok(noDelta.otmPct != null);
});

test("classifyPrint: otmPct is null (never fabricated) when spot is missing or non-positive", () => {
  const noSpot = classifyPrint(fakeFlow(), fakeRaw({ underlying_price: null }));
  assert.equal(noSpot.otmPct, null);
  assert.equal(noSpot.otmPctAbs, null);

  const zeroSpot = classifyPrint(fakeFlow(), fakeRaw({ underlying_price: "0" }));
  assert.equal(zeroSpot.otmPct, null);
});

test("classifyPrint: aggressor direction mirrors flow-accumulation's convention — ask-side calls / bid-side puts = bull", () => {
  const bullCall = classifyPrint(fakeFlow({ option_type: "CALL" }), fakeRaw({ total_ask_side_prem: "900000", total_bid_side_prem: "100000" }));
  assert.equal(bullCall.aggressorDirection, "bull");

  const bearCallOnBidSide = classifyPrint(fakeFlow({ option_type: "CALL" }), fakeRaw({ total_ask_side_prem: "100000", total_bid_side_prem: "900000" }));
  assert.equal(bearCallOnBidSide.aggressorDirection, "bear");

  const bullPutOnBidSide = classifyPrint(fakeFlow({ option_type: "PUT" }), fakeRaw({ total_ask_side_prem: "100000", total_bid_side_prem: "900000" }));
  assert.equal(bullPutOnBidSide.aggressorDirection, "bull");
  assert.equal(bullPutOnBidSide.sideDirection, "bear"); // naive side reading is kept alongside, never overwritten
});

test("classifyPrint: has_floor is used as the disclosed BLOCK proxy, never renamed to imply UW's own label", () => {
  const p = classifyPrint(fakeFlow({ has_sweep: false }), fakeRaw({ has_sweep: false, has_floor: true }));
  assert.equal(p.isFloor, true);
  assert.equal(p.isSweep, false);
});

test("classifyPrint: missing required identity fields (ticker/side/expiry/strike) returns null, never a partial guess", () => {
  assert.equal(classifyPrint(null, fakeRaw()), null);
  assert.equal(classifyPrint(fakeFlow(), null), null);
  assert.equal(classifyPrint(fakeFlow({ option_type: "UNKNOWN" }), fakeRaw()), null);
  assert.equal(classifyPrint(fakeFlow({ strike: 0 }), fakeRaw()), null);
  assert.equal(classifyPrint(fakeFlow({ expiry: null }), fakeRaw()), null);
});

test("classifyPrint: unparseable alert time returns null rather than fabricating a timestamp", () => {
  const p = classifyPrint(fakeFlow({ alerted_at: "not-a-date" }), fakeRaw({ created_at: "also-not-a-date" }));
  assert.equal(p, null);
});

test("identityKey: matches flow-accumulation.ts's own keyOf shape (ticker|expiry|strike|side)", () => {
  const p = classifyPrint(fakeFlow(), fakeRaw());
  assert.equal(identityKey(p), "NVDA|2026-10-16|150|call");
});

test("isHugeSweep / isHugeBlock: gated on the $1M whale floor, sweep and floor flags are mutually exclusive by construction", () => {
  const sweep = classifyPrint(fakeFlow({ premium: 1_500_000, has_sweep: true }), fakeRaw({ has_sweep: true, has_floor: false, total_premium: "1500000" }));
  assert.equal(isHugeSweep(sweep), true);
  assert.equal(isHugeBlock(sweep), false);

  const block = classifyPrint(fakeFlow({ premium: 2_000_000, has_sweep: false }), fakeRaw({ has_sweep: false, has_floor: true, total_premium: "2000000" }));
  assert.equal(isHugeBlock(block), true);
  assert.equal(isHugeSweep(block), false);

  const smallSweep = classifyPrint(fakeFlow({ premium: 500_000, has_sweep: true }), fakeRaw({ has_sweep: true, total_premium: "500000" }));
  assert.equal(isHugeSweep(smallSweep), false);
  assert.equal(isHugeSweep(smallSweep, 100_000), true); // custom floor honored
});

test("HUGE_PREMIUM_FLOOR is the codebase's own pre-existing $1M whale threshold", () => {
  assert.equal(HUGE_PREMIUM_FLOOR, 1_000_000);
});

test("repeatedClassification: 1 = one-off, 2+ = repeated, invalid counts return null rather than a guess", () => {
  assert.equal(repeatedClassification(1), "one-off");
  assert.equal(repeatedClassification(2), "repeated");
  assert.equal(repeatedClassification(7), "repeated");
  assert.equal(repeatedClassification(0), null);
  assert.equal(repeatedClassification(null), null);
  assert.equal(repeatedClassification(undefined), null);
});

test("trendAlignment: requires 20+ closes, reads only closes strictly before/at alert (caller-sliced)", () => {
  const uptrend = Array.from({ length: 25 }, (_, i) => 100 + i); // rising series, last > sma20
  const r1 = trendAlignment(uptrend, "bull");
  assert.equal(r1.uptrend, "up");
  assert.equal(r1.aligned, "aligned");

  const r2 = trendAlignment(uptrend, "bear");
  assert.equal(r2.aligned, "counter-trend");

  const downtrend = Array.from({ length: 25 }, (_, i) => 200 - i);
  const r3 = trendAlignment(downtrend, "bear");
  assert.equal(r3.uptrend, "down");
  assert.equal(r3.aligned, "aligned");
});

test("trendAlignment: fewer than 20 closes or missing direction returns null, never a fabricated trend", () => {
  assert.equal(trendAlignment(Array.from({ length: 10 }, (_, i) => 100 + i), "bull"), null);
  assert.equal(trendAlignment(Array.from({ length: 25 }, (_, i) => 100 + i), null), null);
  assert.equal(trendAlignment(null, "bull"), null);
});

function bars(closes, startT = 1_700_000_000_000) {
  return closes.map((c, i) => ({ t: startT + i * 86_400_000, o: c, h: c, l: c, c, v: 1000 }));
}

test("forwardUnderlyingReturn: N trading days later is just index+N on real daily bars, sign-flipped for bear", () => {
  const dailyBars = bars([100, 102, 105, 98, 110, 120]);
  const bullRet = forwardUnderlyingReturn(dailyBars, 0, 3, "bull"); // 100 -> 98 at idx 3
  assert.equal(bullRet, -2);

  const bearRet = forwardUnderlyingReturn(dailyBars, 0, 3, "bear"); // sign-flipped: bear profits from the drop
  assert.equal(bearRet, 2);

  const fullRun = forwardUnderlyingReturn(dailyBars, 0, 5, "bull"); // 100 -> 120
  assert.equal(fullRun, 20);
});

test("forwardUnderlyingReturn: horizon beyond available bars (not yet enough forward history) returns null, never extrapolates", () => {
  const dailyBars = bars([100, 102, 105]);
  assert.equal(forwardUnderlyingReturn(dailyBars, 0, 10, "bull"), null);
  assert.equal(forwardUnderlyingReturn(dailyBars, 5, 1, "bull"), null); // alertBarIndex itself out of range
});

test("optionReturnProxy: delta+theta linear estimate, floored at 0, disclosed as a proxy not a real fill", () => {
  const dailyBars = bars([100, 100, 100, 105]); // +5 spot move over 3 days
  const p = { entryOptionPrice: 3, delta: 0.5, theta: -0.1 };
  const ret = optionReturnProxy(p, dailyBars, 0, 3);
  // estimated = 3 + 0.5*5 + (-0.1*3) = 3 + 2.5 - 0.3 = 5.2 -> (5.2-3)/3*100 = 73.33%
  assert.equal(ret, 73.33);
});

test("optionReturnProxy: floors the estimate at 0 rather than reporting a nonsensical negative option price", () => {
  const dailyBars = bars([100, 100, 100, 60]); // big adverse move
  const p = { entryOptionPrice: 2, delta: 0.9, theta: -0.05 };
  const ret = optionReturnProxy(p, dailyBars, 0, 3);
  // estimated = max(0, 2 + 0.9*(-40) + (-0.05*3)) = max(0, 2 - 36 - 0.15) = 0
  assert.equal(ret, -100); // (0-2)/2*100
});

test("optionReturnProxy: missing entry price or delta returns null, never a fabricated proxy", () => {
  const dailyBars = bars([100, 100, 100, 105]);
  assert.equal(optionReturnProxy({ entryOptionPrice: 0, delta: 0.5 }, dailyBars, 0, 3), null);
  assert.equal(optionReturnProxy({ entryOptionPrice: 3, delta: null }, dailyBars, 0, 3), null);
  assert.equal(optionReturnProxy(null, dailyBars, 0, 3), null);
});

test("chooseBucketCount: shrinks to fit, never splits a small population thinner than minPerBucket", () => {
  assert.equal(chooseBucketCount(4, { minPerBucket: 5 }), 1);
  assert.equal(chooseBucketCount(9, { minPerBucket: 5 }), 1);
  assert.equal(chooseBucketCount(10, { minPerBucket: 5 }), 2);
  assert.equal(chooseBucketCount(25, { minPerBucket: 5, maxBuckets: 5 }), 5);
  assert.equal(chooseBucketCount(1000, { minPerBucket: 5, maxBuckets: 5 }), 5);
});

test("bucketByVariableQuantile: excludes rows missing the bucketing or outcome variable, never coerces to a bucket", () => {
  const rows = [
    { premium: 1_000_000, fwdRet_5d: 4 },
    { premium: 2_000_000, fwdRet_5d: null }, // missing outcome
    { premium: null, fwdRet_5d: 6 }, // missing bucketing var
    { premium: 3_000_000, fwdRet_5d: 8 },
  ];
  const buckets = bucketByVariableQuantile(rows, "premium", "fwdRet_5d", { minPerBucket: 1 });
  const totalN = buckets.reduce((a, b) => a + b.n, 0);
  assert.equal(totalN, 2);
});

test("bucketByVariableQuantile: per-bucket winRate/avgOutcome computed from the outcome key, quantile-ordered by the variable key", () => {
  const rows = [
    { premium: 1, fwdRet: -10 },
    { premium: 2, fwdRet: -5 },
    { premium: 3, fwdRet: 5 },
    { premium: 4, fwdRet: 10 },
  ];
  const buckets = bucketByVariableQuantile(rows, "premium", "fwdRet", { minPerBucket: 2, maxBuckets: 2 });
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].n, 2);
  assert.equal(buckets[0].winRate, 0); // both negative
  assert.equal(buckets[1].winRate, 100); // both positive
});

test("bucketedMetricVerdict: RANKS requires both a real spread and a monotonic trend, not spread alone", () => {
  const monotonic = [
    { label: "lo", n: 6, winRate: 10 },
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 80 },
  ];
  assert.equal(bucketedMetricVerdict(monotonic, "winRate", { minN: 5 }).verdict, "RANKS");

  const scrambled = [
    { label: "lo", n: 6, winRate: 80 },
    { label: "mid", n: 6, winRate: 10 },
    { label: "hi", n: 6, winRate: 40 },
  ];
  assert.equal(bucketedMetricVerdict(scrambled, "winRate", { minN: 5 }).verdict, "SPREAD WITHOUT ORDER");

  const inverted = [
    { label: "lo", n: 6, winRate: 80 },
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 10 },
  ];
  assert.equal(bucketedMetricVerdict(inverted, "winRate", { minN: 5 }).verdict, "INVERTED");
});

test("bucketedMetricVerdict: FLAT when spread is below threshold regardless of trend", () => {
  const flat = [
    { label: "lo", n: 6, winRate: 41 },
    { label: "mid", n: 6, winRate: 43 },
    { label: "hi", n: 6, winRate: 44 },
  ];
  const r = bucketedMetricVerdict(flat, "winRate", { minN: 5, spreadThreshold: 5 });
  assert.equal(r.verdict, "FLAT");
});

test("bucketedMetricVerdict: thin buckets are named in excluded[], not silently dropped or trusted", () => {
  const mixed = [
    { label: "lo", n: 2, winRate: 90 },
    { label: "mid", n: 6, winRate: 40 },
    { label: "hi", n: 6, winRate: 20 },
  ];
  const r = bucketedMetricVerdict(mixed, "winRate", { minN: 5 });
  assert.deepEqual(r.excluded, ["lo(n=2)"]);
  assert.equal(r.usableBuckets, 2);
});

test("bucketedMetricVerdict: INSUFFICIENT DATA when fewer than 2 usable buckets", () => {
  const thin = [{ label: "only", n: 20, winRate: 50 }];
  assert.equal(bucketedMetricVerdict(thin, "winRate", { minN: 5 }).verdict, "INSUFFICIENT DATA");
});

test("baselineSummary: unconditional population rate, computed before any segmentation", () => {
  const rows = [{ fwdRet: -10 }, { fwdRet: 20 }, { fwdRet: 30 }, { fwdRet: null }];
  const b = baselineSummary(rows, "fwdRet");
  assert.equal(b.n, 3); // null excluded, never coerced to 0
  assert.equal(b.winRate, Math.round((2 / 3) * 100 * 100) / 100);
  assert.equal(b.avgOutcome, Math.round(((-10 + 20 + 30) / 3) * 100) / 100);
});
