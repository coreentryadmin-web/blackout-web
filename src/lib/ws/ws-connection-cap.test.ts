import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WS_CONNECTION_CAP_COOLDOWN_MS,
  isConnectionCapFrame,
  reconnectDelayAfterClose,
  shouldResetBackoffOnAuth,
} from "./ws-connection-cap";

test("isConnectionCapFrame: the real Polygon frame, captured live", () => {
  // Copied verbatim from a 2026-08-09 probe against socket.polygon.io/stocks.
  assert.equal(
    isConnectionCapFrame({
      ev: "status",
      status: "max_connections",
      message:
        "Maximum number of websocket connections exceeded. You have reached the connection limit for your account. Please contact support at https://massive...",
    }),
    true
  );
});

test("isConnectionCapFrame: matches on message text when the status field differs", () => {
  // The two providers word this differently and a third will differ again, so the text is a
  // fallback path rather than the only path.
  assert.equal(
    isConnectionCapFrame({ ev: "status", status: "error", message: "You have reached the connection limit for your account" }),
    true
  );
  assert.equal(
    isConnectionCapFrame({ status: "ERROR", message: "Maximum number of WebSocket connections exceeded" }),
    true,
    "case-insensitive"
  );
});

test("isConnectionCapFrame: does NOT swallow the frames that need a different response", () => {
  // auth_failed is a key problem, not a capacity problem — misclassifying it would put a bad key
  // into a 60s retry loop instead of surfacing it.
  for (const bad of [
    { ev: "status", status: "auth_failed", message: "authentication failed" },
    { ev: "status", status: "unauthorized", message: "not authorized" },
    { ev: "status", status: "auth_success", message: "authenticated" },
    { ev: "status", status: "connected", message: "Connected Successfully" },
    { ev: "status", status: "success", message: "subscribed to: A.AAPL" },
    { ev: "A", sym: "I:SPX", c: 7757 },
  ]) {
    assert.equal(isConnectionCapFrame(bad), false, `misclassified ${JSON.stringify(bad).slice(0, 60)}`);
  }
});

test("isConnectionCapFrame: junk input is not a cap frame", () => {
  for (const bad of [null, undefined, 0, "", "max_connections", [], {}, { message: 5 }]) {
    assert.equal(isConnectionCapFrame(bad), false);
  }
});

test("reconnectDelayAfterClose: a normal close keeps the caller's curve", () => {
  assert.equal(reconnectDelayAfterClose(1000, false), 1000);
  assert.equal(reconnectDelayAfterClose(32_000, false), 32_000);
});

test("reconnectDelayAfterClose: a capacity refusal forces the cooldown", () => {
  // The whole point: the 1s the socket would otherwise use after auth_success is what created the
  // hot loop.
  assert.equal(reconnectDelayAfterClose(1000, true), WS_CONNECTION_CAP_COOLDOWN_MS);
  assert.equal(
    reconnectDelayAfterClose(120_000, true),
    120_000,
    "an already-longer backoff is never SHORTENED by the cooldown"
  );
});

test("shouldResetBackoffOnAuth: auth_success is not success when this connection was capped", () => {
  assert.equal(shouldResetBackoffOnAuth(false), true, "an ordinary connection resets as before");
  assert.equal(
    shouldResetBackoffOnAuth(true),
    false,
    "a capped connection authenticates fine — that is exactly why resetting on it loops forever"
  );
});
