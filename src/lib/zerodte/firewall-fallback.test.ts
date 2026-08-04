import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIREWALL_FAIL_CLOSED_STALE_MS,
  FIREWALL_FALLBACK_MAX_AGE_MS,
  resolveFirewallNumeric,
  resetFirewallFallbackStoresForTests,
} from "./firewall-fallback";

test("resolveFirewallNumeric — fresh read stores and is available", async () => {
  resetFirewallFallbackStoresForTests();
  const r = await resolveFirewallNumeric("2026-08-04", "vix", 18.2, 1_000_000);
  assert.equal(r.value, 18.2);
  assert.equal(r.unavailable, false);
  assert.equal(r.fromFallback, false);
});

test("resolveFirewallNumeric — fallback under 5m is usable and not unavailable", async () => {
  resetFirewallFallbackStoresForTests();
  await resolveFirewallNumeric("2026-08-04", "vix", 17.5, 1_000_000);
  const r = await resolveFirewallNumeric(
    "2026-08-04",
    "vix",
    null,
    1_000_000 + FIREWALL_FAIL_CLOSED_STALE_MS - 1
  );
  assert.equal(r.value, 17.5);
  assert.equal(r.unavailable, false);
  assert.equal(r.fromFallback, true);
});

test("resolveFirewallNumeric — fallback 5m+ trips unavailable (fail-closed)", async () => {
  resetFirewallFallbackStoresForTests();
  await resolveFirewallNumeric("2026-08-04", "vix", 17.5, 1_000_000);
  const r = await resolveFirewallNumeric(
    "2026-08-04",
    "vix",
    null,
    1_000_000 + FIREWALL_FAIL_CLOSED_STALE_MS
  );
  assert.equal(r.value, 17.5);
  assert.equal(r.unavailable, true);
  assert.equal(r.fromFallback, true);
});

test("resolveFirewallNumeric — fallback older than 30m is discarded", async () => {
  resetFirewallFallbackStoresForTests();
  await resolveFirewallNumeric("2026-08-04", "vix", 17.5, 1_000_000);
  const r = await resolveFirewallNumeric(
    "2026-08-04",
    "vix",
    null,
    1_000_000 + FIREWALL_FALLBACK_MAX_AGE_MS
  );
  assert.equal(r.value, null);
  assert.equal(r.unavailable, true);
});
