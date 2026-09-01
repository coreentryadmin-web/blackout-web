import { test } from "node:test";
import assert from "node:assert/strict";

import { rankVectorPlayCandidates, pickContractNearTarget, classifyVectorPickTier, minRankScoreToShow } from "./vector-play-candidates";
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
  conviction = 72,
  setup: VectorPlayPickContext["play"]["setup"] =
    bias === "long"
      ? "momentum-long"
      : bias === "short"
        ? "momentum-short"
        : bias === "range"
          ? "range"
          : "stand-aside"
): VectorPlayPickContext["play"] {
  return {
    style: "swing",
    bias,
    setup,
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
          { option_type: "CALL", premium: 3_700_000, strike, expiry, ask_pct: 85 },
        ],
      },
    },
    chain
  );
  assert.ok(picks.length >= 1);
  assert.ok(picks.some((p) => p.strike === strike && p.reasons?.some((r) => /HELIX/i.test(r))));
});

test("a SOLD call whale print does not surface as a bullish HELIX candidate", () => {
  // Regression pin: a call print with ask_pct <= 40 (hit the bid — sold) is bearish, not a "buy
  // this call" signal, even at whale size. Previously option_type alone drove the candidate.
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
          { option_type: "CALL", premium: 3_700_000, strike, expiry, ask_pct: 10 },
        ],
      },
    },
    chain
  );
  assert.ok(
    !picks.some((p) => p.strike === strike && p.reasons?.some((r) => /HELIX whale/i.test(r))),
    "a sold call must not surface as a HELIX whale long candidate"
  );
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

test("0DTE window: primary-long and gex-king-pin target their own strikes, not both collapsing to nearest-spot", () => {
  // Regression: pickChainContract (Night Hawk's 0DTE picker, reused here for the "0dte" DTE window)
  // ranked purely by distance-to-SPOT with no way to target a different strike. primary-long
  // (targets the put wall) and gex-king-pin (targets the GEX king strike) are different roles with
  // different target strikes, but both used to collapse onto whichever 0DTE contract was nearest
  // spot, with "reason" text that implied a targeting relationship that never actually happened.
  const spot = 100;
  const putWall = 98;
  const king = 95; // below spot, valid gex-king-pin candidate for a long bias
  const chain: EditionChainData = {
    spot,
    rows: [
      row(98, { expiry: ymdPlus(0), callAsk: 4, callBid: 3.6 }),
      row(95, { expiry: ymdPlus(0), callAsk: 6, callBid: 5.6 }),
    ],
  };
  const picks = rankVectorPlayCandidates(
    {
      play: basePlay("long", 70),
      spot,
      putWall,
      enrichment: { gexKingStrike: king, strikeTotals: { "98": 1_000_000, "95": 50_000_000 } },
    },
    chain
  );
  const primary = picks.find((p) => p.role === "primary-long");
  const kingPin = picks.find((p) => p.role === "gex-king-pin");
  assert.ok(primary, "primary-long pick should exist");
  assert.ok(kingPin, "gex-king-pin pick should exist");
  assert.equal(primary!.strike, 98, "primary-long should target the put wall strike");
  assert.equal(kingPin!.strike, 95, "gex-king-pin should target the GEX king strike, not collapse onto primary-long's");
});

test("neutral play returns no picks", () => {
  assert.deepEqual(
    rankVectorPlayCandidates({ play: basePlay("neutral"), spot: 100 }, { spot: 100, rows: [] }),
    []
  );
});

test("pivot play ranks once spot commits past gamma flip", () => {
  const chain: EditionChainData = {
    spot: 353,
    rows: [
      row(353, { expiry: ymdPlus(0), callAsk: 4, callBid: 3.6 }),
      row(353, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.6 }),
      row(350, { expiry: ymdPlus(7), callAsk: 6, callBid: 5.5 }),
    ],
  };
  const play = basePlay("neutral", 72, "pivot");
  assert.deepEqual(
    rankVectorPlayCandidates({ play, spot: 352.56, gammaFlip: 352.56 }, chain),
    [],
    "still on the flip → no ranked picks"
  );
  const picks = rankVectorPlayCandidates(
    { play, spot: 353, gammaFlip: 352.56, putWall: 350 },
    chain
  );
  assert.ok(picks.length > 0, "committed pivot side should surface ranked picks");
  assert.equal(picks[0]?.side, "call");
});

test("bid-only quote (no ask) is still a visible, pickable contract", () => {
  // A contract whose ask has gone dark (thin/wide market, or simply stale) but whose bid is live
  // is real and executable — it must not be invisible to every liquidity tier.
  const chain: EditionChainData = {
    spot: 100,
    rows: [row(100, { expiry: ymdPlus(7), callBid: 4.2 })],
  };
  const picked = pickContractNearTarget(chain, "long", 100, 1, 7);
  assert.ok(picked, "bid-only contract should be picked, not silently dropped");
  assert.equal(picked?.premium, 4.2);
});

test("both bid and ask missing still returns no contract", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [row(100, { expiry: ymdPlus(7) })],
  };
  const picked = pickContractNearTarget(chain, "long", 100, 1, 7);
  assert.equal(picked, null);
});

test("empty chain rows returns no picks, never fabricates a contract", () => {
  const picks = rankVectorPlayCandidates(
    { play: basePlay("long", 70), spot: 100, putWall: 98 },
    { spot: 100, rows: [] }
  );
  assert.deepEqual(picks, []);
});

test("null chain returns no picks", () => {
  const picks = rankVectorPlayCandidates({ play: basePlay("long", 70), spot: 100 }, null);
  assert.deepEqual(picks, []);
});

test("null context returns no picks", () => {
  const chain: EditionChainData = { spot: 100, rows: [row(100, { expiry: ymdPlus(7), callAsk: 4, callBid: 3.6 })] };
  assert.deepEqual(rankVectorPlayCandidates(null, chain), []);
});

test("excludeOccs omits invalidated contracts from the ranked pool", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(98, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
      row(99, { expiry: ymdPlus(7), callAsk: 5, callBid: 4.5 }),
    ],
  };
  const ctx: VectorPlayPickContext = {
    play: basePlay("long", 70),
    spot: 100,
    putWall: 98,
  };
  const all = rankVectorPlayCandidates(ctx, chain, "SPY", { limit: 8 });
  assert.ok(all.length >= 1);
  const firstOcc = all[0]!.occ;
  assert.ok(firstOcc);
  const without = rankVectorPlayCandidates(ctx, chain, "SPY", {
    limit: 8,
    excludeOccs: [firstOcc],
  });
  assert.ok(!without.some((p) => p.occ === firstOcc));
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

test("classifyVectorPickTier: mega whale surfaces elite", () => {
  assert.equal(
    classifyVectorPickTier({
      playGrade: "B",
      playConviction: 62,
      role: "flow-whale",
      rankScore: 74,
      flowPremiumAtStrike: 2_500_000,
      atKeyLevel: false,
    }),
    "elite"
  );
});

test("minRankScoreToShow: whale role lowers bar", () => {
  assert.equal(minRankScoreToShow("flow-whale", 600_000), 44);
  assert.equal(minRankScoreToShow("primary-long", 600_000), 52);
});
