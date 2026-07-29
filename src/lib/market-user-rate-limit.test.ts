import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketFlowsRestLimit,
  marketFlowsSseLimit,
} from "./market-user-rate-limit";

test("market flow rate limits: defaults are generous desk-safe caps", () => {
  const env = { ...process.env };
  delete process.env.MARKET_FLOWS_USER_RATE_LIMIT;
  delete process.env.MARKET_FLOWS_SSE_USER_RATE_LIMIT;
  try {
    assert.equal(marketFlowsRestLimit(), 120);
    assert.equal(marketFlowsSseLimit(), 30);
  } finally {
    process.env.MARKET_FLOWS_USER_RATE_LIMIT = env.MARKET_FLOWS_USER_RATE_LIMIT;
    process.env.MARKET_FLOWS_SSE_USER_RATE_LIMIT = env.MARKET_FLOWS_SSE_USER_RATE_LIMIT;
  }
});

test("market flow rate limits: env overrides", () => {
  process.env.MARKET_FLOWS_USER_RATE_LIMIT = "50";
  process.env.MARKET_FLOWS_SSE_USER_RATE_LIMIT = "10";
  try {
    assert.equal(marketFlowsRestLimit(), 50);
    assert.equal(marketFlowsSseLimit(), 10);
  } finally {
    delete process.env.MARKET_FLOWS_USER_RATE_LIMIT;
    delete process.env.MARKET_FLOWS_SSE_USER_RATE_LIMIT;
  }
});
