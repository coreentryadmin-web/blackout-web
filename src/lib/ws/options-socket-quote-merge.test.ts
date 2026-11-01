import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeQuoteIntoOptionMark } from "./options-socket";
import type { OptionMark } from "./options-socket";

// BUG (found 2026-11-01, live audit — the Quote-side mirror of the Trade-side
// mergeTradeIntoOptionMark fix in options-socket-trade-merge.test.ts). A Massive Quote ("Q")
// frame is NBBO-only — it never carries a trade price of its own — so handleQuote's
// `finiteOrNull(msg.lp ?? msg.last ?? msg.p)` resolves to null on virtually every real quote
// tick. Before this fix, handleQuote built a brand-new OptionMark straight from that null,
// wiping out whatever `last` the most recent Trade ("T") frame had just established. Since a
// contract typically quotes far more often than it trades, `last` was clobbered back to null
// within milliseconds of being set — defeating the documented purpose `last` was added for
// (2026-09-15): letting a caller apply the same bid=0 backstop-quote divergence guard
// (reliableMarkFromQuote, options-snapshot.ts) to the WS mark.

test("REGRESSION: a quote frame with no trade price of its own must carry `last` forward, not null it out", () => {
  const prev: OptionMark = { bid: 1.2, ask: 1.4, mark: 1.3, last: 1.35, ts: 1_000 };
  // A real Massive Q frame: fresh bid/ask, no lp/last/p field at all (quoteLast = null).
  const merged = mergeQuoteIntoOptionMark(prev, 1.25, 1.45, null, 2_000);
  assert.equal(merged.last, 1.35, "last must survive a quote tick that carries no trade price of its own");
  assert.equal(merged.bid, 1.25, "bid still refreshes to the new quote");
  assert.equal(merged.ask, 1.45, "ask still refreshes to the new quote");
  assert.equal(merged.mark, 1.35, "mark recomputes from the fresh bid/ask");
  assert.equal(merged.ts, 2_000, "ts still advances on every real quote — unlike the trade-merge path");
});

test("a quote frame that DOES carry its own trade-price field overwrites the prior last (rare, but correct if it happens)", () => {
  const prev: OptionMark = { bid: 1.2, ask: 1.4, mark: 1.3, last: 1.3, ts: 1_000 };
  const merged = mergeQuoteIntoOptionMark(prev, 1.2, 1.4, 1.38, 2_000);
  assert.equal(merged.last, 1.38, "an explicit value on the frame itself is real new information");
});

test("no prior entry and no trade price on the frame leaves last null (never fabricated)", () => {
  const merged = mergeQuoteIntoOptionMark(undefined, 5, 5.2, null, 100);
  assert.equal(merged.last, null);
  assert.equal(merged.bid, 5);
  assert.equal(merged.ask, 5.2);
  assert.equal(merged.mark, 5.1);
});

test("repeated quote-only ticks with no intervening trade all keep the ORIGINAL trade's last", () => {
  const afterTrade: OptionMark = { bid: 10, ask: 10.2, mark: 10.1, last: 10.15, ts: 500 };
  const afterQuote1 = mergeQuoteIntoOptionMark(afterTrade, 10.05, 10.25, null, 600);
  const afterQuote2 = mergeQuoteIntoOptionMark(afterQuote1, 10.1, 10.3, null, 700);
  assert.equal(afterQuote1.last, 10.15, "first quote tick after the trade must not clobber last");
  assert.equal(afterQuote2.last, 10.15, "last must stay anchored across a run of quote-only ticks");
  assert.equal(afterQuote2.bid, 10.1);
  assert.equal(afterQuote2.ask, 10.3);
});

test("a crossed book (ask < bid) still carries last forward even though mark falls to null", () => {
  const prev: OptionMark = { bid: 2, ask: 2.2, mark: 2.1, last: 2.1, ts: 10 };
  const merged = mergeQuoteIntoOptionMark(prev, 3, 2, null, 20);
  assert.equal(merged.mark, null, "midOf's crossed-book guard still applies");
  assert.equal(merged.last, 2.1, "last is unaffected by the crossed-book mark guard");
});
