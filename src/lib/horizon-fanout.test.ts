import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDte,
  explodeChainRows,
  fanOutContracts,
  fanOutChain,
  DEFAULT_LIQUIDITY,
  type ChainContract,
} from "./horizon-fanout";

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
    c({ dte: 14, expiry: "2026-08-06", delta: 0.6 }), // Swing (0.50–0.75Δ directional stance)
    c({ dte: 60, expiry: "2026-09-21", delta: 0.6 }), // LEAPS
  ];
  const picks = fanOutContracts(contracts);
  assert.equal(picks.length, 3);
  assert.equal(picks[0].contract?.dte, 0);
  assert.equal(picks[1].contract?.dte, 14);
  assert.equal(picks[2].contract?.dte, 60);
});

test("each lane picks the delta closest to its target", () => {
  // Swing target delta 0.60, band [0.50,0.75]: 0.58 beats 0.72 (closest to target)
  const picks = fanOutContracts([
    c({ dte: 10, strike: 90, delta: 0.72 }),
    c({ dte: 10, strike: 105, delta: 0.58 }),
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


test("explodeChainRows: passes the full greek set through for each side", () => {
  // The columns exist on ChainStrikeRow now (fed from the same OptionSnapshot that always carried
  // them), so a pre-entry contract no longer reaches the desk with delta+IV as its only greeks.
  const rows = [
    {
      expiry: "2026-08-06", strike: 100,
      call_bid: 2.0, call_ask: 2.2, call_delta: 0.4, call_oi: 800,
      call_iv: 0.31, call_gamma: 0.0412, call_theta: -0.18, call_vega: 0.077,
      put_bid: 1.5, put_ask: 1.7, put_delta: -0.35, put_oi: 600,
      put_iv: 0.29, put_gamma: 0.0388, put_theta: -0.15, put_vega: 0.071,
    },
  ];
  const [long] = explodeChainRows("XYZ", rows, ASOF, "LONG");
  assert.equal(long.iv, 0.31);
  assert.equal(long.gamma, 0.0412);
  assert.equal(long.theta, -0.18);
  assert.equal(long.vega, 0.077);

  // SHORT must read the PUT side's greeks, not the call's — the bug class this guards against.
  const [short] = explodeChainRows("XYZ", rows, ASOF, "SHORT");
  assert.equal(short.gamma, 0.0388);
  assert.equal(short.theta, -0.15);
  assert.equal(short.vega, 0.071);
});

test("explodeChainRows: a UW-sourced row (no greek columns) yields null, not 0", () => {
  // pivotUwRows has no greeks in its payload at all. Omitted must read as "unknown" — serving 0
  // would claim a real reading of zero gamma/theta/vega, which is a different and false statement.
  const rows = [
    { expiry: "2026-08-06", strike: 100, call_bid: 2.0, call_ask: 2.2, call_delta: 0.4, call_oi: 800, put_bid: 1.5, put_ask: 1.7, put_delta: -0.35, put_oi: 600 },
  ];
  const [c0] = explodeChainRows("XYZ", rows, ASOF, "LONG");
  assert.equal(c0.gamma, null);
  assert.equal(c0.theta, null);
  assert.equal(c0.vega, null);
  assert.equal(c0.delta, 0.4, "delta still flows — only the second-order greeks are absent");
});

test("explodeChainRows: non-finite greeks are normalised to null", () => {
  const rows = [
    {
      expiry: "2026-08-06", strike: 100,
      call_bid: 2.0, call_ask: 2.2, call_delta: 0.4, call_oi: 800,
      call_gamma: Number.NaN, call_theta: Number.POSITIVE_INFINITY, call_vega: null,
      put_bid: 1.5, put_ask: 1.7, put_delta: -0.35, put_oi: 600,
    },
  ];
  const [c0] = explodeChainRows("XYZ", rows, ASOF, "LONG");
  assert.equal(c0.gamma, null);
  assert.equal(c0.theta, null);
  assert.equal(c0.vega, null);
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
    { expiry: "2026-08-06", strike: 108, call_bid: 1.2, call_ask: 1.3, call_delta: 0.6, call_oi: 3000, put_bid: 1, put_ask: 1.1, put_delta: -0.4, put_oi: 300 },
    { expiry: "2026-09-21", strike: 98, call_bid: 6.0, call_ask: 6.3, call_delta: 0.6, call_oi: 1500, put_bid: 1, put_ask: 1.1, put_delta: -0.4, put_oi: 300 },
  ];
  const picks = fanOutChain("XYZ", rows, ASOF, "LONG", DEFAULT_LIQUIDITY);
  assert.equal(picks.find((p) => p.horizon === "ZERO_DTE")!.contract?.expiry, "2026-07-23");
  assert.equal(picks.find((p) => p.horizon === "SWING")!.contract?.expiry, "2026-08-06");
  assert.equal(picks.find((p) => p.horizon === "LEAPS")!.contract?.expiry, "2026-09-21");
});


// ─── SEV-3 (FINDINGS 2026-08-06): explodeChainRows dropped the IV its source rows carry ─────────

test("explodeChainRows: passes the side's IV through (call for LONG, put for SHORT)", () => {
  const rows = [
    {
      expiry: "2026-08-14",
      strike: 180,
      call_bid: 5.4, call_ask: 5.6, call_delta: 0.58, call_oi: 1200, call_iv: 0.42,
      put_bid: 3.1, put_ask: 3.3, put_delta: -0.42, put_oi: 900, put_iv: 0.51,
    },
  ];
  assert.equal(explodeChainRows("NVDA", rows, "2026-08-06", "LONG")[0]!.iv, 0.42);
  assert.equal(explodeChainRows("NVDA", rows, "2026-08-06", "SHORT")[0]!.iv, 0.51);
});

test("explodeChainRows: absent / non-finite IV stays null — never fabricated, never NaN", () => {
  const rows = [
    {
      expiry: "2026-08-14", strike: 180,
      call_bid: 5.4, call_ask: 5.6, call_delta: 0.58, call_oi: 1200, call_iv: Number.NaN,
      put_bid: 3.1, put_ask: 3.3, put_delta: -0.42, put_oi: 900,
    },
  ];
  assert.equal(explodeChainRows("NVDA", rows, "2026-08-06", "LONG")[0]!.iv, null);
  assert.equal(explodeChainRows("NVDA", rows, "2026-08-06", "SHORT")[0]!.iv, null);
});
