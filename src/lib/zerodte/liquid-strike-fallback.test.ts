import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChainStrikeRow } from "@/features/nighthawk/lib/option-chain-prompt";
import {
  chainSpreadPct,
  otmPctForStrike,
  planNeedsLiquidityFallback,
  rankLiquidStrikeAlternatives,
} from "./liquid-strike-fallback";
import { buildContractPlan } from "./plan";

function row(
  strike: number,
  over: Partial<ChainStrikeRow> = {}
): ChainStrikeRow {
  return {
    expiry: "2026-09-04",
    strike,
    call_bid: 2.4,
    call_ask: 2.6,
    call_delta: 0.5,
    call_oi: 800,
    call_iv: 0.4,
    put_bid: 2.3,
    put_ask: 2.5,
    put_delta: -0.5,
    put_oi: 600,
    put_iv: 0.42,
    ...over,
  };
}

test("planNeedsLiquidityFallback: illiquid or quote invalid", () => {
  const clean = buildContractPlan({
    occ: "O:X",
    direction: "long",
    price: 100,
    flowAvgFill: 2.5,
    bid: 2.4,
    ask: 2.6,
    mark: 2.5,
    keySupports: [],
    keyResistances: [],
    vwap: null,
  });
  assert.equal(planNeedsLiquidityFallback(clean), false);

  const illiquid = buildContractPlan({
    occ: "O:X",
    direction: "long",
    price: 100,
    flowAvgFill: 2.5,
    bid: 1.0,
    ask: 2.0,
    mark: 1.5,
    keySupports: [],
    keyResistances: [],
    vwap: null,
  });
  assert.equal(planNeedsLiquidityFallback(illiquid), true);
});

test("rankLiquidStrikeAlternatives: walks nearest strike away from primary", () => {
  const rows = [
    row(100, { call_bid: 2.4, call_ask: 2.6 }),
    row(102.5, { call_bid: 2.3, call_ask: 2.45 }),
    row(105, { call_bid: 2.0, call_ask: 2.2 }),
  ];
  const ranked = rankLiquidStrikeAlternatives({
    rows,
    spot: 100,
    todayYmd: "2026-09-04",
    ticker: "PL",
    expiry: "2026-09-04",
    primaryStrike: 100,
    direction: "long",
  });
  assert.equal(ranked[0]?.strike, 102.5);
  assert.equal(ranked[1]?.strike, 105);
});

test("rankLiquidStrikeAlternatives: skips strikes outside moneyness caps", () => {
  const rows = [row(130, { call_bid: 0.5, call_ask: 0.55 })];
  const ranked = rankLiquidStrikeAlternatives({
    rows,
    spot: 100,
    todayYmd: "2026-09-04",
    ticker: "PL",
    expiry: "2026-09-04",
    primaryStrike: 100,
    direction: "long",
  });
  assert.equal(ranked.length, 0);
});

test("rankLiquidStrikeAlternatives: spreadCap filters wide chain quotes", () => {
  const rows = [
    row(102.5, { call_bid: 1.0, call_ask: 2.0 }),
    row(105, { call_bid: 2.3, call_ask: 2.45 }),
  ];
  const ranked = rankLiquidStrikeAlternatives({
    rows,
    spot: 100,
    todayYmd: "2026-09-04",
    ticker: "PL",
    expiry: "2026-09-04",
    primaryStrike: 100,
    direction: "long",
    spreadCap: 15,
  });
  assert.equal(ranked[0]?.strike, 105);
  assert.equal(ranked.length, 1);
});

test("otmPctForStrike + chainSpreadPct helpers", () => {
  assert.equal(otmPctForStrike("long", 100, 102.5), 2.5);
  assert.ok(chainSpreadPct(2.4, 2.6)! < 10);
  assert.ok(chainSpreadPct(1.0, 2.0)! > 50);
});
