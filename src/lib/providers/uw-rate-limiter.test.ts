import { test } from "node:test";
import assert from "node:assert/strict";

// Set a deterministic threshold BEFORE the target module loads (it reads the env at
// load time). The import is dynamic + inside each async test to avoid top-level await,
// which this project's CJS transform does not support. uw-rate-limiter.ts has no
// @/lib/* imports, so it loads cleanly under `npx tsx --test`.
process.env.UW_CIRCUIT_429_THRESHOLD = "5";

test("breaker trips at exactly THRESHOLD distinct 429s, not half (the double-count regression guard)", async () => {
  const { noteUw429, isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  for (let i = 0; i < 4; i++) noteUw429("test");
  // 4 < 5 -> still closed. If a 429 were double-counted, 4 calls would register 8 and
  // the breaker would (wrongly) already be open here.
  assert.equal(isUwCircuitOpen(), false, "breaker opened too early — 429 likely double-counted");
  noteUw429("test"); // 5th -> reaches threshold
  assert.equal(isUwCircuitOpen(), true, "breaker should open at the configured threshold");
});

test("reset clears breaker state between cases", async () => {
  const { isUwCircuitOpen, resetUwCircuitForTest } = await import("./uw-rate-limiter");
  resetUwCircuitForTest();
  assert.equal(isUwCircuitOpen(), false);
});
