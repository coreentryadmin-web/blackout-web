import { test } from "node:test";
import assert from "node:assert/strict";

import { buildVectorContractPicks, legsForBias } from "./vector-contract-picks";
import type { ChainStrikeRow, EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import { todayEtYmd } from "@/lib/providers/spx-session";

function ymdPlus(days: number): string {
  const t = todayEtYmd();
  const d = new Date(t + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function row(
  strike: number,
  opts: { oi?: number; callAsk?: number; callBid?: number; putAsk?: number; putBid?: number; expiry?: string } = {}
): ChainStrikeRow {
  const oi = opts.oi ?? 5_000;
  return {
    expiry: opts.expiry ?? ymdPlus(30),
    strike,
    call_bid: opts.callBid ?? null,
    call_ask: opts.callAsk ?? null,
    call_delta: null,
    call_oi: oi,
    call_iv: null,
    put_bid: opts.putBid ?? null,
    put_ask: opts.putAsk ?? null,
    put_delta: null,
    put_oi: oi,
    put_iv: null,
  };
}

function chainAround(spot: number): EditionChainData {
  return {
    spot,
    rows: [
      row(spot, { callAsk: 4, callBid: 3.6, putAsk: 4, putBid: 3.6 }),
      row(spot * 0.95, { callAsk: 7, callBid: 6.6, putAsk: 1.2, putBid: 1.0 }),
      row(spot * 1.05, { callAsk: 1.2, callBid: 1.0, putAsk: 7, putBid: 6.6 }),
    ],
  };
}

test("legsForBias: long/short get one leg, range gets both, neutral gets none", () => {
  assert.deepEqual(legsForBias("long"), ["long"]);
  assert.deepEqual(legsForBias("short"), ["short"]);
  assert.deepEqual(legsForBias("range"), ["long", "short"]);
  assert.deepEqual(legsForBias("neutral"), []);
});

test("buildVectorContractPicks: long bias returns one CALL pick at the play's own conviction", () => {
  const chain = chainAround(100);
  const picks = buildVectorContractPicks({ bias: "long", conviction: 72 }, chain, "monthly");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.side, "call");
  assert.equal(picks[0]!.confidence, 72, "confidence is the play's conviction, never a separate number");
  assert.match(picks[0]!.label, /^\d+(\.\d+)?C \d{2}\/\d{2}$/);
});

test("buildVectorContractPicks: short bias returns one PUT pick", () => {
  const chain = chainAround(100);
  const picks = buildVectorContractPicks({ bias: "short", conviction: 55 }, chain, "monthly");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.side, "put");
  assert.equal(picks[0]!.confidence, 55);
});

test("buildVectorContractPicks: range bias returns BOTH legs at the same conviction (one play, two entries)", () => {
  const chain = chainAround(100);
  const picks = buildVectorContractPicks({ bias: "range", conviction: 60 }, chain, "monthly");
  assert.equal(picks.length, 2);
  const sides = picks.map((p) => p.side).sort();
  assert.deepEqual(sides, ["call", "put"]);
  assert.ok(picks.every((p) => p.confidence === 60));
});

test("buildVectorContractPicks: neutral bias (stand-aside/pivot) never fabricates a pick", () => {
  const chain = chainAround(100);
  assert.deepEqual(buildVectorContractPicks({ bias: "neutral", conviction: 40 }, chain, "monthly"), []);
});

test("buildVectorContractPicks: no play or no chain degrades to no picks, never throws", () => {
  assert.deepEqual(buildVectorContractPicks(null, chainAround(100), "monthly"), []);
  assert.deepEqual(buildVectorContractPicks({ bias: "long", conviction: 80 }, null, "monthly"), []);
});

test("buildVectorContractPicks: 0DTE horizon restricts to a same-day expiry", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(100, { expiry: ymdPlus(0), callAsk: 4, callBid: 3.6 }),
      row(100, { expiry: ymdPlus(30), callAsk: 5, callBid: 4.6 }),
    ],
  };
  const picks = buildVectorContractPicks({ bias: "long", conviction: 65 }, chain, "0dte");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.expiry, ymdPlus(0));
});

test("buildVectorContractPicks: a caveated (relaxed) pick still returns a real contract, flagged", () => {
  const illiquid: EditionChainData = {
    spot: 100,
    rows: [row(100, { oi: 10, callAsk: 4, callBid: 3.6 })], // below the liquidity floor
  };
  const picks = buildVectorContractPicks({ bias: "long", conviction: 50 }, illiquid, "monthly");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.caveat, "low_liquidity");
});

test("buildVectorContractPicks: no eligible contract on the requested side → no pick for that leg", () => {
  // Only a call row exists — a short/put leg has nothing to price.
  const callOnly: EditionChainData = {
    spot: 100,
    rows: [row(100, { callAsk: 4, callBid: 3.6, putAsk: null, putBid: null })],
  };
  assert.deepEqual(buildVectorContractPicks({ bias: "short", conviction: 60 }, callOnly, "monthly"), []);
});
