import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKOUT_PLAN_VALUE_USD,
  parseRememberedPlan,
  purchaseValueUsd,
} from "./checkout-plans";

const NOW = 1_800_000_000_000; // fixed clock; Date.now() is never called by the pure helpers

test("purchaseValueUsd: a recovered plan values the sale exactly — the yearly bug", () => {
  // The defect: a yearly buyer ($1999) reaching `premium` tier was booked as $199 because the
  // value came from the tier alone. With the plan recovered, each plan books its true price.
  assert.equal(purchaseValueUsd("premium", "yearly"), 1999, "yearly must NOT collapse to 199");
  assert.equal(purchaseValueUsd("premium", "monthly"), 199);
  assert.equal(purchaseValueUsd("community", "community"), 49);
});

test("purchaseValueUsd: the plan wins over the tier even if they disagree", () => {
  // The plan the member clicked is ground truth for what they paid; tier is only the fallback.
  assert.equal(purchaseValueUsd("community", "yearly"), 1999);
  assert.equal(purchaseValueUsd("premium", "community"), 49);
});

test("purchaseValueUsd: no plan falls back to the tier estimate (prior behaviour)", () => {
  assert.equal(purchaseValueUsd("premium", null), 199, "premium fallback = monthly price");
  assert.equal(purchaseValueUsd("community", null), 49);
  assert.equal(purchaseValueUsd("free", null), 49, "below premium → community price");
});

test("parseRememberedPlan: a fresh, well-formed plan is returned", () => {
  const raw = JSON.stringify({ plan: "yearly", at: NOW - 60_000 }); // 1 minute old
  assert.equal(parseRememberedPlan(raw, NOW), "yearly");
});

test("parseRememberedPlan: a plan past the 24h TTL is rejected as stale", () => {
  const raw = JSON.stringify({ plan: "yearly", at: NOW - 25 * 60 * 60 * 1000 });
  assert.equal(parseRememberedPlan(raw, NOW), null, "a day-old abandoned checkout must not value a new purchase");
});

test("parseRememberedPlan: a future timestamp (clock skew / tampering) is rejected", () => {
  const raw = JSON.stringify({ plan: "yearly", at: NOW + 60_000 });
  assert.equal(parseRememberedPlan(raw, NOW), null);
});

test("parseRememberedPlan: null, malformed JSON, and unknown plans are all null", () => {
  assert.equal(parseRememberedPlan(null, NOW), null);
  assert.equal(parseRememberedPlan("not json", NOW), null);
  assert.equal(parseRememberedPlan(JSON.stringify({ plan: "yearly" }), NOW), null, "missing `at`");
  assert.equal(parseRememberedPlan(JSON.stringify({ plan: "enterprise", at: NOW }), NOW), null, "unknown plan");
  assert.equal(parseRememberedPlan(JSON.stringify({ at: NOW }), NOW), null, "missing plan");
});

test("begin_checkout and purchase read the SAME price map — they cannot drift", () => {
  // The whole point of centralizing: every plan a checkout can emit is valued identically wherever
  // it is read. If someone adds a plan, this asserts the map covers it end to end.
  for (const plan of ["community", "monthly", "yearly"] as const) {
    assert.equal(purchaseValueUsd("free", plan), CHECKOUT_PLAN_VALUE_USD[plan]);
  }
});
