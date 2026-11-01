import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReloadOnBfcacheRestore } from "./BfcacheAuthGuard";

test("shouldReloadOnBfcacheRestore returns true when the page was restored from bfcache", () => {
  assert.equal(shouldReloadOnBfcacheRestore({ persisted: true }), true);
});

test("shouldReloadOnBfcacheRestore returns false on a normal (non-bfcache) load", () => {
  assert.equal(shouldReloadOnBfcacheRestore({ persisted: false }), false);
});
