import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFlowCorroboration,
  breakoutOnlyTickers,
  deriveFlowCorroborationSetups,
  flowCorroborationEnabled,
} from "./flow-corroboration";
import { buildBreakoutSetup } from "./breakout-source";
import { deriveZeroDteSetups, enrichSetup } from "./board";

const TODAY = "2026-08-25";

function cleanFlowRow(
  ticker: string,
  over: Partial<{
    premium: number;
    option_type: string;
    strike: number;
    ask_pct: number;
    alert_rule: string;
    alerted_at: string;
  }> = {}
) {
  return {
    ticker,
    premium: over.premium ?? 1_000_000,
    option_type: over.option_type ?? "call",
    strike: over.strike ?? 480,
    expiry: TODAY,
    dte: 0,
    alert_rule: over.alert_rule ?? "RepeatedHitsAscendingFill",
    ask_pct: over.ask_pct ?? 72,
    underlying_price: 478,
    fill_price: 3.5,
    open_interest: 5000,
    alerted_at: over.alerted_at ?? `${TODAY}T14:00:00.000Z`,
  };
}

test("flowCorroborationEnabled defaults ON", () => {
  const prev = process.env.ZERODTE_FLOW_CORROBORATION;
  delete process.env.ZERODTE_FLOW_CORROBORATION;
  assert.equal(flowCorroborationEnabled(), true);
  process.env.ZERODTE_FLOW_CORROBORATION = "0";
  assert.equal(flowCorroborationEnabled(), false);
  if (prev === undefined) delete process.env.ZERODTE_FLOW_CORROBORATION;
  else process.env.ZERODTE_FLOW_CORROBORATION = prev;
});

test("breakoutOnlyTickers lists BREAKOUT without FLOW, skips multi-rail", () => {
  const setups = [
    { ticker: "MSTR", discovery_origin: ["BREAKOUT"] as const },
    { ticker: "NVDA", discovery_origin: ["FLOW", "BREAKOUT"] as const },
    { ticker: "ASTS", discovery_origin: ["BREAKOUT"] as const },
  ];
  assert.deepEqual(breakoutOnlyTickers(setups), ["MSTR", "ASTS"]);
});

test("applyFlowCorroboration unions FLOW onto a BREAKOUT-only row", () => {
  const breakout = buildBreakoutSetup({
    mover: { ticker: "MSTR", gain: 0.18, close_strength: 0.92, volume: 2e7, dollar: 8e8 },
    spot: 340,
    contract: { strike: 345, expiry: TODAY, dte: 0 },
    dollarNorm: 0.9,
  });
  assert.deepEqual(breakout.discovery_origin, ["BREAKOUT"]);
  const beforeScore = breakout.score;

  const flow = deriveZeroDteSetups([cleanFlowRow("MSTR", { premium: 2_500_000 })], {
    todayYmd: TODAY,
    nowMs: Date.parse(`${TODAY}T14:05:00Z`),
  }).map((s) => enrichSetup(s, null))[0]!;
  assert.ok(flow, "flow corroboration must survive evidence gates");

  const setups = [breakout];
  const merged = applyFlowCorroboration(setups, [flow]);
  assert.equal(merged, 1);
  assert.deepEqual(setups[0]!.discovery_origin, ["FLOW", "BREAKOUT"]);
  assert.ok(setups[0]!.gross_premium > 0, "flow evidence is stamped on the merged row");
  assert.equal(setups[0]!.score, Math.min(100, beforeScore + 8), "same-direction corroboration gets +8");
});

test("deriveFlowCorroborationSetups uses the same evidence gates as global FLOW", () => {
  const weak = deriveFlowCorroborationSetups([cleanFlowRow("QQQ", { premium: 50_000 })], {
    todayYmd: TODAY,
    nowMs: Date.parse(`${TODAY}T14:05:00Z`),
  });
  assert.equal(weak.length, 0, "below SETUP_MIN_GROSS must not corroborate");
});
