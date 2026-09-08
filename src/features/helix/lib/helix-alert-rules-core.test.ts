import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowToHelixAlertRule,
  sanitizeIncomingHelixAlertRule,
  matchesHelixAlertRule,
  type HelixAlertRule,
} from "./helix-alert-rules-core";

test("rowToHelixAlertRule: numeric min_premium, valid side, enabled coerced", () => {
  const rule = rowToHelixAlertRule({ ticker: "TSLA", min_premium: 500000, side: "CALL", enabled: true });
  assert.deepEqual(rule, { ticker: "TSLA", minPremium: 500000, side: "CALL", enabled: true });
});

test("rowToHelixAlertRule: string min_premium from pg is coerced to a number", () => {
  const rule = rowToHelixAlertRule({ ticker: "SPY", min_premium: "250000", side: null, enabled: false });
  assert.equal(rule.minPremium, 250000);
  assert.equal(typeof rule.minPremium, "number");
});

test("rowToHelixAlertRule: an invalid side value (corrupted row) reads as null (either), not thrown", () => {
  const rule = rowToHelixAlertRule({ ticker: "QQQ", min_premium: 100000, side: "GARBAGE", enabled: true });
  assert.equal(rule.side, null);
});

test("rowToHelixAlertRule: a non-finite min_premium reads as 0, never NaN propagated forward", () => {
  const rule = rowToHelixAlertRule({ ticker: "QQQ", min_premium: "not-a-number", side: null, enabled: true });
  assert.equal(rule.minPremium, 0);
});

test("sanitizeIncomingHelixAlertRule: accepts a well-formed payload", () => {
  const clean = sanitizeIncomingHelixAlertRule("NVDA", { minPremium: 300000, side: "PUT", enabled: true });
  assert.deepEqual(clean, { minPremium: 300000, side: "PUT", enabled: true });
});

test("sanitizeIncomingHelixAlertRule: rejects a non-positive/non-finite minPremium rather than defaulting it", () => {
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: 0, side: null, enabled: true }), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: -5, side: null, enabled: true }), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: "not-a-number", side: null, enabled: true }), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: NaN, side: null, enabled: true }), null);
});

test("sanitizeIncomingHelixAlertRule: an unrecognized side value falls back to null (either), not rejected", () => {
  const clean = sanitizeIncomingHelixAlertRule("NVDA", { minPremium: 100000, side: "garbage", enabled: true });
  assert.equal(clean?.side, null);
});

test("sanitizeIncomingHelixAlertRule: rejects a missing/non-boolean enabled rather than guessing true", () => {
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: 100000, side: null }), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", { minPremium: 100000, side: null, enabled: "yes" }), null);
});

test("sanitizeIncomingHelixAlertRule: rejects a non-object payload", () => {
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", null), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", "not an object"), null);
  assert.equal(sanitizeIncomingHelixAlertRule("NVDA", 42), null);
});

function rule(overrides: Partial<HelixAlertRule> = {}): HelixAlertRule {
  return { ticker: "TSLA", minPremium: 500000, side: null, enabled: true, ...overrides };
}

test("matchesHelixAlertRule: fires when ticker matches and premium clears the floor", () => {
  assert.equal(matchesHelixAlertRule(rule(), { ticker: "TSLA", premium: 600000, option_type: "CALL" }), true);
});

test("matchesHelixAlertRule: does not fire below the premium floor", () => {
  assert.equal(matchesHelixAlertRule(rule(), { ticker: "TSLA", premium: 499999, option_type: "CALL" }), false);
});

test("matchesHelixAlertRule: premium exactly at the floor fires (inclusive)", () => {
  assert.equal(matchesHelixAlertRule(rule(), { ticker: "TSLA", premium: 500000, option_type: "PUT" }), true);
});

test("matchesHelixAlertRule: a disabled rule never fires, regardless of premium", () => {
  assert.equal(
    matchesHelixAlertRule(rule({ enabled: false }), { ticker: "TSLA", premium: 10_000_000, option_type: "CALL" }),
    false
  );
});

test("matchesHelixAlertRule: a mismatched ticker never fires", () => {
  assert.equal(matchesHelixAlertRule(rule(), { ticker: "AAPL", premium: 600000, option_type: "CALL" }), false);
});

test("matchesHelixAlertRule: side-scoped rule only fires on that side", () => {
  const callOnly = rule({ side: "CALL" });
  assert.equal(matchesHelixAlertRule(callOnly, { ticker: "TSLA", premium: 600000, option_type: "CALL" }), true);
  assert.equal(matchesHelixAlertRule(callOnly, { ticker: "TSLA", premium: 600000, option_type: "PUT" }), false);
});

test("matchesHelixAlertRule: side=null fires on either side", () => {
  const either = rule({ side: null });
  assert.equal(matchesHelixAlertRule(either, { ticker: "TSLA", premium: 600000, option_type: "CALL" }), true);
  assert.equal(matchesHelixAlertRule(either, { ticker: "TSLA", premium: 600000, option_type: "PUT" }), true);
});
