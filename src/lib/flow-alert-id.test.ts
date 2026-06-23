import { test } from "node:test";
import assert from "node:assert/strict";
import { flowFallbackAlertId } from "./flow-alert-id";

const base = {
  ticker: "SPX",
  alerted_at: "2026-06-22T14:30:00Z",
  strike: 5400,
  option_type: "call",
  premium: 250000,
};

test("distinct premium => distinct keys", () => {
  assert.notEqual(
    flowFallbackAlertId({ ...base, premium: 250000 }),
    flowFallbackAlertId({ ...base, premium: 260000 })
  );
});

test("distinct trade_count => distinct keys", () => {
  assert.notEqual(
    flowFallbackAlertId({ ...base, trade_count: 3 }),
    flowFallbackAlertId({ ...base, trade_count: 5 })
  );
});

test("null trade_count omits the suffix", () => {
  const withNull = flowFallbackAlertId({ ...base, trade_count: null });
  assert.equal(withNull, flowFallbackAlertId(base));
  assert.equal(withNull, "uw:SPX:2026-06-22T14:30:00Z:5400:call:250000");
});

test("keeps uw: prefix and : delimiter (no pipe)", () => {
  assert.ok(flowFallbackAlertId(base).startsWith("uw:"));
  assert.ok(!flowFallbackAlertId(base).includes("|"));
});
