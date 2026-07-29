import assert from "node:assert/strict";
import test from "node:test";
import {
  chainQuoteForParsedPlay,
  evaluatePlayAgainstChain,
  playPremiumWithinChainBand,
  STRIKE_MIN_OI,
  type ChainStrikeRow,
} from "./option-chain-prompt";

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
