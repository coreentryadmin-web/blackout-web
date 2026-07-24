import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankSwingContracts,
  swingContractThesisFit,
  swingContractTradability,
  breakevenMovePct,
  chainContractFromSnapshot,
  SWING_CONTRACT_RANK_GRADUATED,
} from "./contract-ranker.ts";
import { SWING_SUB_LANES } from "./taxonomy.ts";
import { HORIZONS } from "../horizons.ts";
import type { ChainContract } from "../horizon-fanout.ts";
import { mapUnifiedSnapshotResult } from "../providers/options-snapshot.ts";

// A STANDARD-lane call with sensible defaults (8–21 DTE, band [0.50,0.72], target 0.60).
function mkContract(over: Partial<ChainContract> = {}): ChainContract {
  const bid = over.bid ?? 3.9;
  const ask = over.ask ?? 4.1;
  return {
    ticker: "NVDA",
    right: "C",
    expiry: "2026-08-07",
    dte: 14,
    strike: 98,
    delta: 0.6,
    openInterest: 1000,
    bid,
    ask,
    mid: bid != null && ask != null ? (bid + ask) / 2 : null,
    bidSize: 60,
    askSize: 60,
    dayVolume: 300,
    ...over,
  };
}

test("weights are evidence-only (not graduated)", () => {
  assert.equal(SWING_CONTRACT_RANK_GRADUATED, false);
});

test("HORIZONS.SWING.contract is the 0.60Δ directional stance (SEV-4/FM#5), not the 0.35Δ banger", () => {
  assert.equal(HORIZONS.SWING.contract.targetDelta, 0.6);
  assert.deepEqual(HORIZONS.SWING.contract.deltaBand, [0.5, 0.75]);
});

test("0.60Δ beats 0.30Δ on breakeven-headroom at EQUAL tradability", () => {
  const spot = 100;
  // Equal tradability: identical spread FRACTION (0.05), quote size, OI, volume — only the instrument
  // stance (delta/strike/premium, hence breakeven) differs. mid 4 → spread 0.2; mid 1.5 → spread 0.075.
  const near = mkContract({ delta: 0.6, strike: 98, bid: 3.9, ask: 4.1 }); // mid 4.0, spread% 0.05, be 102 → 2%
  const lotto = mkContract({ delta: 0.3, strike: 108, bid: 1.4625, ask: 1.5375 }); // mid 1.5, spread% 0.05, be 109.5 → 9.5%

  // Same tradability inputs → equal tradability (isolates thesisFit as the sole differentiator).
  const gate = SWING_SUB_LANES.STANDARD.liquidity;
  assert.equal(
    swingContractTradability(near, gate).toFixed(6),
    swingContractTradability(lotto, gate).toFixed(6),
  );

  // Breakeven headroom: the near-the-money 0.60Δ needs a far smaller move.
  const nearMove = breakevenMovePct(near, "LONG", spot)!;
  const lottoMove = breakevenMovePct(lotto, "LONG", spot)!;
  assert.ok(nearMove < lottoMove, `near ${nearMove} should need less move than lotto ${lottoMove}`);

  // → higher thesisFit for the directional stance.
  const nearFit = swingContractThesisFit(near, "STANDARD", "LONG", spot);
  const lottoFit = swingContractThesisFit(lotto, "STANDARD", "LONG", spot);
  assert.ok(nearFit > lottoFit, `0.60Δ fit ${nearFit} must beat 0.30Δ fit ${lottoFit}`);
});

test("tighter-spread / bigger-size wins at EQUAL thesis-fit", () => {
  // Same strike + delta + dte + mid ⇒ identical thesisFit; only tradability separates them.
  const tight = mkContract({ strike: 98, bid: 3.95, ask: 4.05, bidSize: 90, askSize: 90 }); // spread 0.025
  const wide = mkContract({ strike: 98, bid: 3.6, ask: 4.4, bidSize: 5, askSize: 5 }); // spread 0.20

  const r = rankSwingContracts([wide, tight], "STANDARD", "LONG", 100);
  assert.ok(r.pick, "a pick exists");
  // Equal thesisFit → the tighter-spread / bigger-size contract must win on tradability.
  assert.equal(r.ranked[0].thesisFit.toFixed(6), r.ranked[1].thesisFit.toFixed(6));
  assert.ok(r.ranked[0].tradability > r.ranked[1].tradability);
  assert.strictEqual(r.pick, tight);
});

test("null greeks degrade to a tradability-only pick without throwing", () => {
  const a = mkContract({ strike: 100, delta: null, bidSize: 20, askSize: 20 });
  const b = mkContract({ strike: 95, delta: null, bid: 6.0, ask: 6.2, bidSize: 90, askSize: 90 });
  let r: ReturnType<typeof rankSwingContracts>;
  assert.doesNotThrow(() => {
    r = rankSwingContracts([a, b], "STANDARD", "LONG", 100);
  });
  r = rankSwingContracts([a, b], "STANDARD", "LONG", 100);
  assert.ok(r.pick, "a pick is still made with null greeks");
  assert.match(r.reason, /no greeks/);
});

test("the pick is INVARIANT to topFlowStrike — flow is provenance, never a driver", () => {
  const s95 = mkContract({ strike: 95, bid: 6.0, ask: 6.1, bidSize: 80, askSize: 80 });
  const s98 = mkContract({ strike: 98, bid: 3.9, ask: 4.1, bidSize: 80, askSize: 80 });
  const pool = [s95, s98];

  const baseline = rankSwingContracts(pool, "STANDARD", "LONG", 100);
  assert.ok(baseline.pick);
  const pickStrike = baseline.pick!.strike;

  // Flow strike = a DIFFERENT strike than the pick → pick must NOT move to it.
  const other = pickStrike === 95 ? 98 : 95;
  const withOtherFlow = rankSwingContracts(pool, "STANDARD", "LONG", 100, { topFlowStrike: other });
  assert.equal(withOtherFlow.pick!.strike, pickStrike, "pick unchanged when flow points elsewhere");
  assert.equal(withOtherFlow.topFlowWasPicked, false);
  assert.equal(withOtherFlow.topFlowStrike, other);

  // Flow strike = the pick's own strike → still the same pick; only provenance flips true.
  const withMatchingFlow = rankSwingContracts(pool, "STANDARD", "LONG", 100, { topFlowStrike: pickStrike });
  assert.equal(withMatchingFlow.pick!.strike, pickStrike);
  assert.equal(withMatchingFlow.topFlowWasPicked, true);

  // Byte-identical pick object regardless of flow input.
  assert.strictEqual(baseline.pick, withOtherFlow.pick);
  assert.strictEqual(baseline.pick, withMatchingFlow.pick);
});

test("SHORT direction ranks puts and honors the same |delta| band", () => {
  const put = mkContract({ right: "P", strike: 102, delta: 0.6, bid: 3.9, ask: 4.1 });
  const call = mkContract({ right: "C", strike: 98, delta: 0.6 });
  const r = rankSwingContracts([put, call], "STANDARD", "SHORT", 100);
  assert.ok(r.pick);
  assert.equal(r.pick!.right, "P", "SHORT picks a put, never the call");
});

test("mapper: bid_size / ask_size / session.volume flow through OptionSnapshot → ChainContract", () => {
  const raw = {
    ticker: "O:NVDA260807C00098000",
    type: "options",
    implied_volatility: 0.42,
    open_interest: 1234,
    greeks: { delta: 0.61, gamma: 0.02, theta: -0.05, vega: 0.1 },
    last_quote: { bid: 3.9, ask: 4.1, bid_size: 44, ask_size: 77 },
    session: { close: 4.0, volume: 512 },
    details: { strike_price: 98, contract_type: "call", expiration_date: "2026-08-07" },
    underlying_asset: { price: 100 },
  };
  const snap = mapUnifiedSnapshotResult(raw as never);
  assert.ok(snap, "snapshot maps");
  assert.equal(snap!.bidSize, 44);
  assert.equal(snap!.askSize, 77);
  assert.equal(snap!.dayVolume, 512);

  const cc = chainContractFromSnapshot(snap!, "NVDA", "2026-07-24");
  assert.ok(cc, "chain contract maps");
  assert.equal(cc!.bidSize, 44);
  assert.equal(cc!.askSize, 77);
  assert.equal(cc!.dayVolume, 512);
  assert.equal(cc!.right, "C");
  assert.equal(cc!.strike, 98);
  assert.equal(cc!.delta, 0.61); // |delta| magnitude
  assert.equal(cc!.iv, 0.42);
  assert.equal(cc!.dte, 14); // 2026-07-24 → 2026-08-07
  assert.equal(cc!.mid, 4.0);
});

test("mapper skips malformed snapshots (no throw, null out)", () => {
  const snap = mapUnifiedSnapshotResult({
    ticker: "O:X", type: "options",
    details: { contract_type: "call" }, // no strike / no expiry
  } as never);
  assert.ok(snap); // OptionSnapshot still maps (strike/expiry null)
  assert.equal(chainContractFromSnapshot(snap!, "X", "2026-07-24"), null);
});
