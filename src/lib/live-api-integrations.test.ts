import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUwPathLiveIntegrated,
  getUwLiveIntegrationPaths,
  UW_FETCH_FUNCTION_PATHS,
} from "@/lib/live-api-integrations";

test("isUwPathLiveIntegrated: true for an actually-wired endpoint", () => {
  // Exact match (same shape, same param name) for a real fetchUw* wrapper.
  assert.equal(isUwPathLiveIntegrated("/api/stock/{ticker}/nope"), true);
  // Different placeholder name, same shape — normalize() must still match.
  assert.equal(isUwPathLiveIntegrated("/api/stock/{symbol}/nope"), true);
});

test("isUwPathLiveIntegrated: false for a documented-but-unwired sibling endpoint", () => {
  // Shares only the static root ("/api/stock/") before the first `{param}` with
  // real integrations — must NOT be reported as live-integrated just because of
  // that shared prefix. Regression for the "any two UW stock endpoints share the
  // same prefix" false-positive (see the function's own doc comment).
  assert.equal(
    isUwPathLiveIntegrated("/api/stock/{ticker}/balance-sheets"),
    false
  );
  assert.equal(
    isUwPathLiveIntegrated("/api/stock/{ticker}/insider-buy-sells"),
    false
  );
  assert.equal(isUwPathLiveIntegrated("/api/economy/{indicator}/made-up"), false);
  assert.equal(
    isUwPathLiveIntegrated("/api/stock/{ticker}/totally-unintegrated-endpoint"),
    false
  );
});

test("isUwPathLiveIntegrated: never returns true for a path that isn't a live path at all", () => {
  // Sanity: confirm the fixtures above really are absent from the live set, so
  // the prior test is checking the right thing and not accidentally matching
  // something real.
  const live = getUwLiveIntegrationPaths();
  assert.ok(!live.includes("/api/stock/{ticker}/balance-sheets"));
  assert.ok(!live.includes("/api/stock/{ticker}/insider-buy-sells"));
});

test("isUwPathLiveIntegrated: WS socket channel paths still match exactly", () => {
  assert.equal(isUwPathLiveIntegrated("/api/socket/flow_alerts"), true);
  assert.equal(isUwPathLiveIntegrated("/api/socket/not_a_real_channel"), false);
});

test("UW_FETCH_FUNCTION_PATHS entries all round-trip through isUwPathLiveIntegrated", () => {
  for (const path of Object.values(UW_FETCH_FUNCTION_PATHS)) {
    assert.equal(isUwPathLiveIntegrated(path), true, `expected ${path} to match itself`);
  }
});
