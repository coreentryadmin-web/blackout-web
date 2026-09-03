import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnrichedZeroDteSetup } from "./board";
import type { ZeroDteVectorPulse } from "./vector-crosslink";
import {
  resolveVectorPulseContract,
  rankVectorContractOnChain,
  resolveZeroDteContractAttach,
  vectorRankContractsEnabled,
} from "./vector-contract-resolve";

const baseSetup = (over: Partial<EnrichedZeroDteSetup> = {}): EnrichedZeroDteSetup =>
  ({
    ticker: "NVDA",
    direction: "long",
    score: 78,
    top_strike: 140,
    expiry: "2026-09-03",
    discovery_origin: ["FLOW"],
    play_type: "DIRECTIONAL",
    ...over,
  }) as EnrichedZeroDteSetup;

const winnerPulse = (): ZeroDteVectorPulse => ({
  premium_pct: 80,
  peak_premium_pct: 90,
  action_status: "still_buy",
  is_winner: true,
  is_runner: false,
  side: "call",
  direction: "long",
  strike: 142,
  occ: "O:NVDA260903C00142000",
  rank: 1,
  role: "flow-whale",
});

test("resolveVectorPulseContract: aligned winner with OCC wins", () => {
  const r = resolveVectorPulseContract(baseSetup(), winnerPulse());
  assert.ok(r);
  assert.equal(r!.source, "vector_pulse");
  assert.equal(r!.strike, 142);
});

test("resolveVectorPulseContract: opposite direction → null", () => {
  assert.equal(resolveVectorPulseContract(baseSetup({ direction: "short" }), winnerPulse()), null);
});

test("vectorRankContractsEnabled: on by default", () => {
  assert.equal(vectorRankContractsEnabled({}), true);
  assert.equal(vectorRankContractsEnabled({ ZERODTE_VECTOR_RANK_CONTRACTS: "0" }), false);
});

test("resolveZeroDteContractAttach: falls back to discovery when no pulse", () => {
  const r = resolveZeroDteContractAttach(baseSetup(), null, null);
  assert.ok(r);
  assert.equal(r!.source, "discovery");
});

test("rankVectorContractOnChain: returns null without chain", () => {
  assert.equal(rankVectorContractOnChain(baseSetup(), winnerPulse(), null), null);
});
