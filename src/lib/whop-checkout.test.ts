import { test } from "node:test";
import assert from "node:assert/strict";
import { missingWhopCheckoutVars } from "./whop-checkout";

test("missingWhopCheckoutVars: all four flagged when nothing is set", () => {
  const missing = missingWhopCheckoutVars({});
  assert.deepEqual(
    new Set(missing),
    new Set([
      "NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY",
      "NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY",
      "NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY",
      "NEXT_PUBLIC_WHOP_STORE_URL",
    ])
  );
});

test("missingWhopCheckoutVars: legacy fallback covers ONLY monthly/store, never yearly/community (2026-10-11 fix)", () => {
  // Regression for a live bug: the old filter treated `legacyCheckout` being set as covering
  // ALL FOUR vars, even though only monthly/store actually fall back to it in WHOP_CHECKOUT
  // below (yearly/community fall back to "" unconditionally). A partial legacy-var migration —
  // legacyCheckout set, yearly/community left unset — silenced the missing-var warning entirely
  // while the upgrade page silently dropped the Yearly and SPX Slayer checkout options.
  const missing = missingWhopCheckoutVars({
    NEXT_PUBLIC_WHOP_CHECKOUT_PRO: "https://whop.com/legacy",
  });
  assert.deepEqual(
    new Set(missing),
    new Set(["NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY", "NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY"])
  );
});

test("missingWhopCheckoutVars: nothing missing once every var (or its applicable legacy fallback) is set", () => {
  const missing = missingWhopCheckoutVars({
    NEXT_PUBLIC_WHOP_CHECKOUT_PRO: "https://whop.com/legacy",
    NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY: "https://whop.com/yearly",
    NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY: "https://whop.com/community",
  });
  assert.deepEqual(missing, []);
});

test("missingWhopCheckoutVars: fully configured without any legacy var reports nothing missing", () => {
  const missing = missingWhopCheckoutVars({
    NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: "https://whop.com/monthly",
    NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY: "https://whop.com/yearly",
    NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY: "https://whop.com/community",
    NEXT_PUBLIC_WHOP_STORE_URL: "https://whop.com/store",
  });
  assert.deepEqual(missing, []);
});
