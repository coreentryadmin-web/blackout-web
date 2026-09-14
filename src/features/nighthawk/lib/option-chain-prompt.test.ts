import assert from "node:assert/strict";
import test from "node:test";
import {
  chainQuoteForParsedPlay,
  evaluatePlayAgainstChain,
  playPremiumWithinChainBand,
  rowFromOptionSnapshot,
  STRIKE_MIN_OI,
  type ChainStrikeRow,
} from "./option-chain-prompt";
import type { OptionSnapshot } from "@/lib/providers/options-snapshot";

// task #141: evaluatePlayAgainstChain's `ok`/`verified`/`contradicted` fields already gated
// claude-edition.ts's illiquid-strike rejection loop; `matchedOi` is a NEW, purely additive
// field (the actual best-OI number the OI-floor check already computed internally) so a
// durable rejection-audit row can cite the real liquidity number that failed, not just a
// boolean. This suite pins that `ok`/`verified`/`contradicted` are byte-for-byte unchanged
// while `matchedOi` reports the right value (or null) in each branch.

function row(overrides: Partial<ChainStrikeRow>): ChainStrikeRow {
  return {
    expiry: "2026-08-21",
    strike: 190,
    call_bid: 4,
    call_ask: 4.5,
    call_delta: 0.5,
    call_oi: 0,
    call_iv: 1,
    put_bid: 3,
    put_ask: 3.5,
    put_delta: -0.5,
    put_oi: 0,
    put_iv: 1,
    ...overrides,
  };
}

test("evaluatePlayAgainstChain: contradicted strike reports the actual (sub-floor) OI, not just a boolean", () => {
  const v = evaluatePlayAgainstChain("SNDK 190C 2026-08-21", [row({ call_oi: 220 })]);
  assert.equal(v.ok, false);
  assert.equal(v.verified, false);
  assert.equal(v.contradicted, true);
  assert.equal(v.matchedOi, 220);
});

test("evaluatePlayAgainstChain: a verified (liquid) strike reports the OI that cleared the floor", () => {
  const v = evaluatePlayAgainstChain("SNDK 190C 2026-08-21", [row({ call_oi: 900 })]);
  assert.equal(v.ok, true);
  assert.equal(v.verified, true);
  assert.equal(v.contradicted, false);
  assert.equal(v.matchedOi, 900);
});

test("evaluatePlayAgainstChain: the best OI across multiple matching rows is reported", () => {
  const v = evaluatePlayAgainstChain("SNDK 190C 2026-08-21", [
    row({ call_oi: 100 }),
    row({ call_oi: 600 }),
  ]);
  assert.equal(v.matchedOi, 600);
});

test("evaluatePlayAgainstChain: strike absent from the chain window is unverifiable, matchedOi is null", () => {
  const v = evaluatePlayAgainstChain("SNDK 250C 2026-08-21", [row({ strike: 190, call_oi: 900 })]);
  assert.equal(v.ok, true);
  assert.equal(v.verified, false);
  assert.equal(v.contradicted, false);
  assert.equal(v.matchedOi, null);
});

test("evaluatePlayAgainstChain: an unparseable contract is unverifiable, matchedOi is null", () => {
  const v = evaluatePlayAgainstChain("see chain for details", [row({ call_oi: 900 })]);
  assert.equal(v.ok, true);
  assert.equal(v.matchedOi, null);
});

test("STRIKE_MIN_OI is the default floor evaluatePlayAgainstChain applies (500)", () => {
  assert.equal(STRIKE_MIN_OI, 500);
  const justBelow = evaluatePlayAgainstChain("SNDK 190C 2026-08-21", [row({ call_oi: STRIKE_MIN_OI - 1 })]);
  assert.equal(justBelow.contradicted, true);
  const justAtFloor = evaluatePlayAgainstChain("SNDK 190C 2026-08-21", [row({ call_oi: STRIKE_MIN_OI })]);
  assert.equal(justAtFloor.contradicted, false);
});

test("chainQuoteForParsedPlay: picks the matched expiry, not the first same-strike row", () => {
  const parsed = { strike: 180, side: "call" as const, expiryYmd: "2026-08-01" };
  const quote = chainQuoteForParsedPlay(parsed, [
    row({ expiry: "2026-07-25", strike: 180, call_bid: 0.9, call_ask: 1.0 }),
    row({ expiry: "2026-08-01", strike: 180, call_bid: 3.2, call_ask: 3.42 }),
  ]);
  assert.ok(quote);
  assert.ok(Math.abs(quote!.ref - 3.31) < 0.05);
  assert.equal(playPremiumWithinChainBand(3.42, quote!), true);
  assert.equal(playPremiumWithinChainBand(1.0, quote!), false);
});

test("chainQuoteForParsedPlay: returns null without expiry or side", () => {
  assert.equal(chainQuoteForParsedPlay({ strike: 180, side: null, expiryYmd: "2026-08-01" }, [row({})]), null);
  assert.equal(chainQuoteForParsedPlay({ strike: 180, side: "call", expiryYmd: null }, [row({})]), null);
});

// ---------------------------------------------------------------------------
// rowFromOptionSnapshot: backstop-quote ask guard (2026-09-14)
//
// `augmentChainsWithExactContracts` calls this mapper to build the exact-contract
// ChainStrikeRow that `groundPlay`'s premium-reconciliation check (grounding.ts) later reads
// via `sideAsk` to OVERWRITE a play's published entry_premium with "the live contract mark".
// A `bid:0` snapshot can carry a market-maker backstop `ask` an order of magnitude above the
// contract's real last-traded price (live case: CRSR 260918C00015000 — the same shape the
// swing/banger lane's `reliableMarkFromSnapshot` fix (options-snapshot.ts, PR #4969) already
// guards for `snap.mark`). This mapper stores the RAW ask, not the mark, so it needed its own
// guard using the same reference fields and threshold.
// ---------------------------------------------------------------------------

function optionSnapshot(overrides: Partial<OptionSnapshot> = {}): OptionSnapshot {
  return {
    ticker: "O:CRSR260918C00015000",
    mark: 7.5,
    bid: 0,
    ask: 15,
    last: 0.07,
    dayClose: 0.07,
    delta: 0.02,
    gamma: 0.001,
    theta: -0.01,
    vega: 0.02,
    iv: 0.9,
    openInterest: 1200,
    bidSize: null,
    askSize: null,
    dayVolume: 10,
    underlyingPrice: 12,
    strike: 15,
    optionType: "call",
    expiry: "2026-09-18",
    sharesPerContract: 100,
    quoteUpdatedMs: null,
    ...overrides,
  };
}

test("rowFromOptionSnapshot: a bid:0 backstop ask 107x above last/dayClose falls back to the last-trade reference, not the fabricated ask", () => {
  const row2 = rowFromOptionSnapshot(optionSnapshot());
  assert.ok(row2);
  assert.equal(row2!.call_ask, 0.07, "must use the honest last/dayClose reference, not the $15 backstop ask");
  assert.equal(row2!.call_bid, 0, "bid is passed through unchanged — only ask is guarded");
});

test("rowFromOptionSnapshot: a real two-sided market (bid>0) is never second-guessed even if ask/last diverge", () => {
  const row2 = rowFromOptionSnapshot(optionSnapshot({ bid: 6.8, ask: 7.2, last: 0.5, dayClose: 0.5 }));
  assert.ok(row2);
  assert.equal(row2!.call_ask, 7.2, "a genuine bid>0 quote is trusted as-is regardless of last-trade divergence");
});

test("rowFromOptionSnapshot: a bid:0 ask within 10x of the reference is trusted as-is (not every bid:0 quote is a backstop)", () => {
  const row2 = rowFromOptionSnapshot(optionSnapshot({ bid: 0, ask: 0.5, last: 0.07, dayClose: 0.07 }));
  assert.ok(row2);
  assert.equal(row2!.call_ask, 0.5, "0.5 <= 0.07 * 10 -- within the honest-divergence band, not a backstop artifact");
});

test("rowFromOptionSnapshot: put side is guarded identically to call side", () => {
  const row2 = rowFromOptionSnapshot(
    optionSnapshot({ optionType: "put", bid: 0, ask: 20, last: 0.1, dayClose: 0.1 })
  );
  assert.ok(row2);
  assert.equal(row2!.put_ask, 0.1);
  assert.equal(row2!.call_ask, null, "the opposite side stays untouched");
});
