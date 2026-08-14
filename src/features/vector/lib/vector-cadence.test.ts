import { test } from "node:test";
import assert from "node:assert/strict";
import { vectorWallsScopePollMs } from "./vector-cadence";

test("vectorWallsScopePollMs: oracle + shared universe 5s, on-demand 15s", () => {
  assert.equal(vectorWallsScopePollMs("SPX"), 5_000);
  assert.equal(vectorWallsScopePollMs("META"), 5_000);
  assert.equal(vectorWallsScopePollMs("NVDA"), 5_000);
  assert.equal(vectorWallsScopePollMs("ZZZZ"), 15_000);
});
