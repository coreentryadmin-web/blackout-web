import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTradeIntoOptionMark } from "./options-socket";
import type { OptionMark } from "./options-socket";

// BUG (found 2026-09-17, live audit): a Trade ("T") print used to always stamp `ts: Date.now()`
// while carrying bid/ask/mark forward UNCHANGED from the last real Quote whenever one existed.
// `OptionMark.ts` is documented ("epoch ms when this mark was received/updated") and trusted by
// every downstream staleness check (isWsUpdatedAtFresh/isZeroDteMarkStale) to mean exactly that
// — so a genuinely stale mark (last real quote update long ago) could read as fresh forever as
// long as sporadic trade prints kept arriving with no accompanying fresh quote. Same root-cause
// shape as the 2026-09-13 REST-side "own fetch clock vs quote clock" fix in
// legacy-option-mark-row.ts, on the WS ingestion path instead.

test("REGRESSION: a trade print must NOT refresh ts when it only carries forward an existing mark", () => {
  const prev: OptionMark = { bid: 1.2, ask: 1.4, mark: 1.3, last: 1.3, ts: 1_000 };
  const merged = mergeTradeIntoOptionMark(prev, 1.35, 999_000 /* now, ~998s later */);
  assert.equal(merged.ts, 1_000, "ts must stay anchored to when the mark was actually established, not the trade print time");
  assert.equal(merged.mark, 1.3, "mark is untouched by a trade print — only a fresh Quote updates it");
  assert.equal(merged.bid, 1.2);
  assert.equal(merged.ask, 1.4);
  assert.equal(merged.last, 1.35, "last IS updated to the new trade print");
});

test("a trade print that establishes the FIRST mark (no prior quote) DOES stamp ts to now", () => {
  const merged = mergeTradeIntoOptionMark(undefined, 2.5, 5_000);
  assert.equal(merged.ts, 5_000, "this trade is genuinely new information — ts must reflect it");
  assert.equal(merged.mark, 2.5, "mark falls back to the trade price when no quote-derived mark exists yet");
  assert.equal(merged.bid, null);
  assert.equal(merged.ask, null);
});

test("a trade print when the prior quote resulted in a null mark also stamps ts to now", () => {
  // e.g. a crossed/invalid book from the last Quote (mark stayed null under midOf's own guard).
  const prev: OptionMark = { bid: 5, ask: 4, mark: null, last: 4.5, ts: 100 };
  const merged = mergeTradeIntoOptionMark(prev, 4.6, 200);
  assert.equal(merged.ts, 200, "no mark was ever established, so this trade's own price is new info");
  assert.equal(merged.mark, 4.6);
});

test("repeated trade prints with no intervening quote all stay anchored to the original quote's ts", () => {
  const quoteEstablished: OptionMark = { bid: 10, ask: 10.2, mark: 10.1, last: 10.1, ts: 0 };
  const afterTrade1 = mergeTradeIntoOptionMark(quoteEstablished, 10.15, 30_000);
  const afterTrade2 = mergeTradeIntoOptionMark(afterTrade1, 10.18, 60_000);
  assert.equal(afterTrade1.ts, 0);
  assert.equal(afterTrade2.ts, 0, "ts must not creep forward across a chain of trade-only updates");
});
