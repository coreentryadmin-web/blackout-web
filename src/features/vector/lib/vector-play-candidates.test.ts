import { test } from "node:test";
import assert from "node:assert/strict";

import { rankVectorPlayCandidates, pickContractNearTarget } from "./vector-play-candidates";
import type { ChainStrikeRow, EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import type { VectorPlayPickContext } from "./vector-play-candidates";
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

function basePlay(
  bias: "long" | "short" | "range" | "neutral",
  conviction = 72
): VectorPlayPickContext["play"] {
  return {
    style: "swing",
    bias,
    conviction,
    grade: "A",
    headline: "test play",
    thesis: "test thesis",
    targets: [],
    starred: [],
  };
}

test("range bias: spot near call wall ranks put fade before call dip", () => {
  const spot = 576;
  const putWall = 567;
  const callWall = 580;
  const chain: EditionChainData = {
    spot,
    rows: [
      row(567, { expiry: ymdPlus(0), callAsk: 12, callBid: 11, putAsk: 3, putBid: 2.8 }),
      row(580, { expiry: ymdPlus(0), putAsk: 12, putBid: 11, callAsk: 3, callBid: 2.8 }),
      row(572, { expiry: ymdPlus(5), callAsk: 8, callBid: 7.5, putAsk: 8, putBid: 7.5 }),
    ],
  };
  const ctx: VectorPlayPickContext = {
    play: basePlay("range", 75),
    spot,
    putWall,
    callWall,
    platformInputs: null,
  };
  const picks = rankVectorPlayCandidates(ctx, chain);
  assert.ok(picks.length >= 1);
  const puts = picks.filter((p) => p.side === "put");
  const calls = picks.filter((p) => p.side === "call");
  if (puts.length && calls.length) {
    assert.ok(
      (puts[0]!.rank ?? 99) < (calls[0]!.rank ?? 99),
      "put fade should rank above call dip when spot is closer to call wall"
    );
  }
});

test("every pick exposes play.conviction as confidence — no per-pick invented score", () => {
  const chain: EditionChainData = {
    spot: 102,
    rows: [
      row(95, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
      row(105, { expiry: ymdPlus(7), putAsk: 5, putBid: 4.5 }),
    ],
  };
  const picks = rankVectorPlayCandidates(
    {
      play: basePlay("range", 75),
      spot: 102,
      putWall: 95,
      callWall: 105,
    },
    chain
  );
  for (const p of picks) {
    assert.equal(p.confidence, 75);
    assert.ok((p.evidence?.length ?? 0) >= 2);
  }
});

test("multi-DTE: prefers weekly over 0DTE for swing-style play when both exist", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(100, { expiry: ymdPlus(0), callAsk: 4, callBid: 3.6 }),
      row(100, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.6 }),
    ],
  };
  const picks = rankVectorPlayCandidates(
    {
      play: { ...basePlay("long"), style: "swing" },
      spot: 100,
      putWall: 98,
    },
    chain
  );
  assert.ok(picks.length >= 1);
  const hasWeekly = picks.some((p) => p.expiry === ymdPlus(7));
  assert.ok(hasWeekly, "weekly candidate should rank for swing play");
});

test("HELIX whale print surfaces as a scored candidate with reason", () => {
  const strike = 572.5;
  const expiry = ymdPlus(5);
  const chain: EditionChainData = {
    spot: 576,
    rows: [row(strike, { expiry, callAsk: 6, callBid: 5.5 })],
  };
  const picks = rankVectorPlayCandidates(
    {
      play: basePlay("long", 70),
      spot: 576,
      platformInputs: {
        sessionFlows: [
          { option_type: "CALL", premium: 3_700_000, strike, expiry },
        ],
      },
    },
    chain
  );
  assert.ok(picks.length >= 1);
  assert.ok(picks.some((p) => p.strike === strike && p.reasons?.some((r) => /HELIX/i.test(r))));
});

test("GEX king strike boosts rank when enrichment present", () => {
  const king = 100;
  const chain: EditionChainData = {
    spot: 102,
    rows: [
      row(king, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
      row(98, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
    ],
  };
  const picks = rankVectorPlayCandidates(
    {
      play: basePlay("long", 70),
      spot: 102,
      putWall: 98,
      enrichment: {
        gexKingStrike: king,
        strikeTotals: { "100": 50_000_000, "98": 1_000_000 },
      },
    },
    chain
  );
  assert.ok(picks.length >= 1);
  const top = picks[0]!;
  assert.equal(top.strike, king);
  assert.ok(top.reasons?.some((r) => /GEX king|net-gamma pin/i.test(r)));
});

test("neutral play returns no picks", () => {
  assert.deepEqual(
    rankVectorPlayCandidates({ play: basePlay("neutral"), spot: 100 }, { spot: 100, rows: [] }),
    []
  );
});

test("pickContractNearTarget: chooses strike closest to target in DTE window", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(98, { expiry: ymdPlus(7), callAsk: 4, callBid: 3.6 }),
      row(102, { expiry: ymdPlus(7), callAsk: 4, callBid: 3.6 }),
    ],
  };
  const picked = pickContractNearTarget(chain, "long", 98, 1, 7);
  assert.equal(picked?.strike, 98);
});
