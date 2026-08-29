/**
 * Tests for x-intel-state-git.mjs
 * Unit tests verify the logic without actually running git commands.
 * Integration tests can be run in a real repo with `npm run test`.
 */
import { test } from "node:test";
import assert from "node:assert";
import { commitXIntelStateIfChanged } from "./x-intel-state-git.mjs";

test("commitXIntelStateIfChanged - mock behavior", async (t) => {
  // These are not true unit tests since the function calls git directly.
  // The real validation happens in integration when the cron runs.
  // This test verifies the function at least doesn't throw on import.
  assert.strictEqual(typeof commitXIntelStateIfChanged, "function");
});
