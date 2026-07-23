import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDte,
  explodeChainRows,
  fanOutContracts,
  fanOutChain,
  DEFAULT_LIQUIDITY,
  type ChainContract,
} from "./horizon-fanout.ts";

const ASOF = "2026-07-23";

// A liquid normalized contract with sensible defaults, overridable.
function c(over: Partial<ChainContract>): ChainContract {
  return {
    ticker: "TEST",
    right: "C",
    expiry: "2026-07-24",
    dte: 1,
    strike: 100,
    delta: 0.5,
    openInterest: 1000,
    bid: 1.0,
    ask: 1.1,
    mid: 1.05,
    ...over,
  };
}

test("calendarDte counts calendar days", () => {
  assert.equal(calendarDte("2026-07-23", "2026-07-23"), 0);
  assert.equal(calendarDte("2026-07-23", "2026-07-24"), 1);
  assert.equal(calendarDte("2026-07-23", "2026-08-22"), 30);
  assert.equal(calendarDte("2026-07-23", "2026-10-21"), 90);
});

test("one mover fans out to all three horizons at once", () => {
  const contracts = [
    c({ dte: 0, expiry: "2026-07-23", delta: 0.5 }), // 0DTE
    c({ dte: 14, expiry: "2026-08-06", delta: 0.35 }), // Swing
    c({ dte: 60, expiry: "2026-09-21", delta: 0.6 }), // LEAPS
  ];
  const picks = fanOutContracts(contracts);
  assert.equal(picks.length, 3);
  assert.equal(picks[0].contract?.dte, 0);
  assert.equal(picks[1].contract?.dte, 14);
  assert.equal(picks[2].contract?.dte, 60);
});

test("each lane picks the delta closest to its target", () => {
  // Swing target delta 0.35, band [0.25,0.50]: 0.34 beats 0.48
  const picks = fanOutContracts([
    c({ dte: 10, strike: 90, delta: 0.48 }),
    c({ dte: 10, strike: 105, delta: 0.34 }),
  ]);
  const swing = picks.find((p) => p.horizon === "SWING")!;
  assert.equal(swing.contract?.strike, 105);
});

test("liquidity gate rejects thin OI, wide spread, and over-cap premium", () => {
  const thin = fanOutContracts([c({ dte: 0, openInterest: 10 })]);
  assert.equal(thin[0].contract, null);
  assert.match(thin[0].reason, /liquidity gate/);

  const wide = fanOutContracts([c({ dte: 0, bid: 1.0, ask: 2.0, mid: 1.5 })]); // 66% spread
  assert.equal(wide[0].contract, null);

  const pricey = fanOutContracts([c({ dte: 0, bid: 40, ask: 41, mid: 40.5 })]); // > $35 cap
  assert.equal(pricey[0].contract, null);
});

test("a lane with no expiry in range returns null with a reason", () => {
  const picks = fanOutContracts([c({ dte: 5 })]); // only Swing has a contract
  assert.equal(picks.find((p) => p.horizon === "ZERO_DTE")!.contract, null);
  assert.match(picks.find((p) => p.horizon === "ZERO_DTE")!.reason, /no listed expiry/);
  assert.ok(picks.find((p) => p.horizon === "SWING")!.contract);
  assert.equal(picks.find((p) => p.horizon === "LEAPS")!.contract, null);
});

test("contracts missing delta can't satisfy the band", () => {
  const picks = fanOutContracts([c({ dte: 0, delta: null })]);
  assert.equal(picks[0].contract, null);
  assert.match(picks[0].reason, /delta/);
});

test("explodeChainRows: LONG takes calls, SHORT takes puts, computes dte + abs delta + mid", () => {
  const rows = [
    { expiry: "2026-08-06", strike: 100, call_bid: 2.0, call_ask: 2.2, call_delta: 0.4, call_oi: 800, put_bid: 1.5, put_ask: 1.7, put_delta: -0.35, put_oi: 600 },
  ];
  const longs = explodeChainRows("XYZ", rows, ASOF, "LONG");
  assert.equal(longs[0].right, "C");
  assert.equal(longs[0].dte, 14);
  assert.equal(longs[0].delta, 0.4);
  assert.equal(longs[0].mid, 2.1);

  const shorts = explodeChainRows("XYZ", rows, ASOF, "SHORT");
  assert.equal(shorts[0].right, "P");
  assert.equal(shorts[0].delta, 0.35); // absolute value of -0.35
  assert.equal(shorts[0].mid, 1.6);
});

test("fanOutChain end-to-end: raw rows → three picks", () => {
  const rows = [
    { expiry: "2026-07-23", strike: 100, call_bid: 1.0, call_ask: 1.1, call_delta: 0.5, call_oi: 5000, put_bid: 1, put_ask: 1.1, put_delta: -0.5, put_oi: 5000 },
    { expiry: "2026-08-06", strike: 108, call_bid: 1.2, call_ask: 1.3, call_delta: 0.34, call_oi: 3000, put_bid: 1, put_ask: 1.1, put_delta: -0.4, put_oi: 300 },
    { expiry: "2026-09-21", strike: 98, call_bid: 6.0, call_ask: 6.3, call_delta: 0.6, call_oi: 1500, put_bid: 1, put_ask: 1.1, put_delta: -0.4, put_oi: 300 },
  ];
  const picks = fanOutChain("XYZ", rows, ASOF, "LONG", DEFAULT_LIQUIDITY);
  assert.equal(picks.find((p) => p.horizon === "ZERO_DTE")!.contract?.expiry, "2026-07-23");
  assert.equal(picks.find((p) => p.horizon === "SWING")!.contract?.expiry, "2026-08-06");
  assert.equal(picks.find((p) => p.horizon === "LEAPS")!.contract?.expiry, "2026-09-21");
});
