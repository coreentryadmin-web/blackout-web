import test from "node:test";
import assert from "node:assert/strict";
import { computeSpxGapContext } from "./spx-gap";

function daily(closes: number[]) {
  return closes.map((c) => ({ o: c, h: c, l: c, c }));
}

test("computeSpxGapContext: up-gap that HOLDS above open is gap_and_go", () => {
  const ctx = computeSpxGapContext(daily([99, 100]), [{ o: 101, h: 101.5, l: 100.8, c: 101.2 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_and_go");
});

test("computeSpxGapContext: up-gap that fades ALL THE WAY back through prior close is gap_and_trap", () => {
  // daily([99, 100]) -> prior_close is the SECOND-TO-LAST bar's close (99), today's daily open/close
  // (100) is only used as an intraday fallback here.
  const ctx = computeSpxGapContext(daily([99, 100]), [{ o: 101, h: 101, l: 98, c: 98 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_and_trap");
});

test("computeSpxGapContext: up-gap that fades off the open but stays ABOVE prior close is gap_fill, not gap_and_trap", () => {
  // Regression pin: prior_close=100, session_open=101 (+1% gap up), last_price=100.5 — a genuine
  // partial fade (price gave back the open but never crossed back below the prior close). The old
  // boundary logic compared last_price only to session_open in both branches, which left gap_fill
  // mathematically unreachable and mislabeled every partial fade as a full reversal.
  const ctx = computeSpxGapContext(daily([99, 100]), [{ o: 101, h: 101, l: 100.4, c: 100.5 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_fill", "a partial fade above prior close must not read as a full reversal");
});

test("computeSpxGapContext: down-gap that HOLDS below open is gap_and_go", () => {
  const ctx = computeSpxGapContext(daily([101, 100]), [{ o: 99, h: 99.2, l: 98.5, c: 98.8 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_and_go");
});

test("computeSpxGapContext: down-gap that reclaims ALL THE WAY back through prior close is gap_and_trap", () => {
  const ctx = computeSpxGapContext(daily([101, 100]), [{ o: 99, h: 101.5, l: 99, c: 101.5 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_and_trap");
});

test("computeSpxGapContext: down-gap that bounces off the open but stays BELOW prior close is gap_fill, not gap_and_trap", () => {
  const ctx = computeSpxGapContext(daily([101, 100]), [{ o: 99, h: 99.6, l: 99, c: 99.5 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "gap_fill", "a partial bounce below prior close must not read as a full reversal");
});

test("computeSpxGapContext: a small gap is flat_open", () => {
  const ctx = computeSpxGapContext(daily([100, 100.1]), [{ o: 100.1, h: 100.2, l: 100.05, c: 100.15 }]);
  assert.ok(ctx);
  assert.equal(ctx!.pattern, "flat_open");
});
