import { test } from "node:test";
import assert from "node:assert/strict";
import { todayEt } from "@/features/nighthawk/lib/session";
import type { EnrichedZeroDteSetup } from "./board";
import type { ZeroDteVectorPulse } from "./vector-crosslink-core";
import {
  resolveVectorPulseContract,
  rankVectorContractOnChain,
  resolveZeroDteContractAttach,
  vectorRankContractsEnabled,
} from "./vector-contract-resolve";

/** `today + n` calendar days, for OCC fixtures — avoids a hardcoded date going stale. */
function datePlusDays(n: number): Date {
  const today = new Date(`${todayEt()}T12:00:00Z`);
  today.setUTCDate(today.getUTCDate() + n);
  return today;
}

function occYmdPlusDays(n: number): string {
  const d = datePlusDays(n);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function isoYmdPlusDays(n: number): string {
  return datePlusDays(n).toISOString().slice(0, 10);
}

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

// 2026-10-08 finding: Vector pulse OCCs were attached with no DTE validation at all — unlike
// rankVectorContractAlternatives' own `dte > 4` filter — so a pulse tracking a multi-week contract
// (CIFR, 2026-10-08: pulse OCC expiry 7 days past the setup's own flagged 0DTE target) got attached
// as if it were in-window. These two tests pin the fix: reject beyond ZERODTE_MAX_DTE, accept and
// carry expiry/dte within it.
test("resolveVectorPulseContract: pulse OCC expiring beyond ZERODTE_MAX_DTE is rejected", () => {
  const farPulse: ZeroDteVectorPulse = {
    ...winnerPulse(),
    occ: `O:NVDA${occYmdPlusDays(8)}C00142000`,
  };
  assert.equal(resolveVectorPulseContract(baseSetup({ expiry: todayEt() }), farPulse), null);
});

test("resolveVectorPulseContract: pulse OCC within ZERODTE_MAX_DTE is accepted and carries expiry/dte", () => {
  const nearPulse: ZeroDteVectorPulse = {
    ...winnerPulse(),
    occ: `O:NVDA${occYmdPlusDays(1)}C00142000`,
  };
  const r = resolveVectorPulseContract(baseSetup({ expiry: todayEt() }), nearPulse);
  assert.ok(r);
  assert.equal(r!.dte, 1);
  assert.equal(r!.expiry, isoYmdPlusDays(1));
});
