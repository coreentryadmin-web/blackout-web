import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("recheckSseUserEntitlement resolves tier without session JWT claims", () => {
  const src = readFileSync(join(root, "src/lib/sse-stream-entitlement.ts"), "utf8");
  assert.match(src, /resolveUserTier\(userId\)/);
  assert.doesNotMatch(src, /sessionClaims/);
});

test("zerodte marks stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(
    join(root, "src/app/api/market/zerodte/marks/stream/route.ts"),
    "utf8",
  );
  assert.match(src, /recheckSseUserEntitlement\(streamUserId/);
  assert.match(src, /streamUserId/);
});

test("vector stream rechecks entitlement on every user tick", () => {
  const src = readFileSync(join(root, "src/app/api/market/vector/stream/route.ts"), "utf8");
  assert.match(src, /recheckSseUserEntitlement\(streamUserId/);
  assert.match(src, /streamUserId/);
});

test("flows stream rechecks entitlement on every user send", () => {
  const src = readFileSync(join(root, "src/app/api/market/flows/stream/route.ts"), "utf8");
  assert.match(src, /recheckSseUserEntitlement\(streamUserId/);
  assert.match(src, /streamUserId/);
});

// A production crash-level alert (2026-09-09, twice in ~20 minutes) showed an
// unhandled promise rejection escaping vector/stream's fire-and-forget `void send()`
// tick, originating in this file's recheckSseUserEntitlement re-throw path (any
// non-degraded-mode failure re-throws rather than degrading). All three SSE stream
// routes call `send()`/`send(payload)` the same fire-and-forget way with nothing to
// catch a rejection anywhere in the chain — src/lib/sse-safe-tick.ts's
// runSseTickSafely is the shared fix point (behavioral tests live there; this file
// can't import it directly since sse-safe-tick avoids this file's `server-only`
// dependency chain on purpose, to stay unit-testable).

test("vector stream routes its interval/initial send() through runSseTickSafely", () => {
  const src = readFileSync(join(root, "src/app/api/market/vector/stream/route.ts"), "utf8");
  assert.match(src, /from "@\/lib\/sse-safe-tick"/);
  assert.match(src, /runSseTickSafely\(sendTick, "vector-stream"\)/);
  assert.match(src, /void send\(\);/);
});

test("zerodte marks stream routes its interval/initial send() through runSseTickSafely", () => {
  const src = readFileSync(
    join(root, "src/app/api/market/zerodte/marks/stream/route.ts"),
    "utf8",
  );
  assert.match(src, /from "@\/lib\/sse-safe-tick"/);
  assert.match(src, /runSseTickSafely\(sendTick, "zerodte-marks-stream"\)/);
  assert.match(src, /void send\(\);/);
});

test("flows stream routes every send() call and the flow-event callback through runSseTickSafely", () => {
  const src = readFileSync(join(root, "src/app/api/market/flows/stream/route.ts"), "utf8");
  assert.match(src, /from "@\/lib\/sse-safe-tick"/);
  assert.match(src, /runSseTickSafely\(\(\) => sendTick\(payload\), "flows-stream"\)/);
  assert.match(src, /runSseTickSafely\(async \(\) => \{/);
});
