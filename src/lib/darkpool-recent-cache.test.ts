import test from "node:test";
import assert from "node:assert/strict";
import { coerceDarkPoolRecentRows } from "./providers/unusual-whales.ts";

test("coerceDarkPoolRecentRows: passes through raw row arrays", () => {
  const rows = [{ ticker: "NVDA", premium: 2_000_000, executed_at: "2026-08-04T14:00:00" }];
  const out = coerceDarkPoolRecentRows(rows);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0]?.ticker, "NVDA");
});

test("coerceDarkPoolRecentRows: unwraps legacy snapshot poisoned cache", () => {
  const snap = {
    prints: [
      { ticker: "TSLA", premium: 1_500_000, side: "buy", executed_at: "2026-08-04T15:00:00", strike: 250 },
    ],
    total_premium: 1_500_000,
    call_premium: 0,
    put_premium: 0,
    bias: "neutral",
    pcr: null,
    detail: "1 print(s)",
  };
  const out = coerceDarkPoolRecentRows(snap);
  assert.equal(out?.length, 1);
  assert.equal(out?.[0]?.ticker, "TSLA");
  assert.equal(out?.[0]?.premium, 1_500_000);
  assert.equal(out?.[0]?.price, 250);
});

test("coerceDarkPoolRecentRows: null for garbage", () => {
  assert.equal(coerceDarkPoolRecentRows(null), null);
  assert.equal(coerceDarkPoolRecentRows({ foo: 1 }), null);
});
