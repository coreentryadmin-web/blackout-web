import { test } from "node:test";
import assert from "node:assert/strict";
import { isUwTransientNetwork } from "./uw-transient-network";

test("matches undici/node connect-level transient errors (RT-2 class)", () => {
  for (const s of [
    "fetch failed",
    "TypeError: fetch failed",
    "ConnectTimeoutError: Connect Timeout Error (attempted address: api.unusualwhales.com:443, timeout: 10000ms)",
    "connect EHOSTUNREACH 198.44.194.59:443",
    "connect ENETUNREACH 1.2.3.4:443",
    "connect ECONNREFUSED 1.2.3.4:443",
    "read ECONNRESET",
    "connect ETIMEDOUT 1.2.3.4:443",
    "Connect Timeout Error  code: UND_ERR_CONNECT_TIMEOUT",
    "getaddrinfo EAI_AGAIN api.unusualwhales.com",
    "getaddrinfo ENOTFOUND api.unusualwhales.com",
    "socket hang up",
  ]) {
    assert.ok(isUwTransientNetwork(s), s);
  }
});

test("does NOT match HTTP status errors (those route to status-specific branches)", () => {
  assert.equal(isUwTransientNetwork("Unusual Whales /flow/alerts → 429"), false);
  assert.equal(isUwTransientNetwork("Unusual Whales /flow/alerts → 429 circuit"), false);
  assert.equal(isUwTransientNetwork("Unusual Whales /flow/alerts → 503"), false);
  assert.equal(isUwTransientNetwork("Unusual Whales /flow → 403"), false);
});

test("does NOT match an unrelated app error", () => {
  assert.equal(isUwTransientNetwork("Cannot read properties of undefined"), false);
  assert.equal(isUwTransientNetwork("UW_API_KEY not set"), false);
  assert.equal(isUwTransientNetwork(""), false);
});
