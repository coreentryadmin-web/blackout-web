import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRankedVectorPicks, buildVectorContractPicks } from "./vector-contract-picks";
import type { ChainStrikeRow, EditionChainData } from "@/features/nighthawk/lib/option-chain-prompt";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { VectorPlayPickContext } from "./vector-play-candidates";

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

function ctx(
  bias: "long" | "short" | "range",
  spot: number,
  walls?: { put?: number; call?: number },
  conviction = 72
): VectorPlayPickContext {
  return {
    play: {
      style: "swing",
      bias,
      conviction,
      grade: "A",
      headline: "test",
      thesis: "thesis",
      targets: [],
      starred: [],
    },
    spot,
    putWall: walls?.put ?? null,
    callWall: walls?.call ?? null,
  };
}

test("buildRankedVectorPicks: long bias returns CALL with independent score", () => {
  const chain = { spot: 100, rows: [row(100, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 })] };
  const picks = buildRankedVectorPicks(ctx("long", 100, { put: 98 }), chain);
  assert.ok(picks.length >= 1);
  assert.equal(picks[0]!.side, "call");
  assert.ok(picks[0]!.reasons?.length);
});

test("buildRankedVectorPicks: range legs do NOT share identical confidence when both show", () => {
  const chain = {
    spot: 102,
    rows: [
      row(95, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
      row(105, { expiry: ymdPlus(7), putAsk: 5, putBid: 4.5 }),
    ],
  };
  const picks = buildRankedVectorPicks(ctx("range", 102, { put: 95, call: 105 }, 75), chain);
  if (picks.length >= 2) {
    assert.notEqual(picks[0]!.confidence, picks[1]!.confidence);
  }
});

test("buildVectorContractPicks shim: neutral returns []", () => {
  assert.deepEqual(buildVectorContractPicks({ bias: "neutral", conviction: 50 }, { spot: 100, rows: [] }, "monthly"), []);
});

test("buildVectorContractPicks shim: no chain returns []", () => {
  assert.deepEqual(buildVectorContractPicks({ bias: "long", conviction: 80 }, null, "monthly"), []);
});
