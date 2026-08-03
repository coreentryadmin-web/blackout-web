import assert from "node:assert/strict";
import test from "node:test";
import { decideEditionForceLock, editionHasLockedPlays } from "./edition-lock";

test("editionHasLockedPlays is true only when plays array non-empty", () => {
  assert.equal(editionHasLockedPlays([]), false);
  assert.equal(editionHasLockedPlays([{ ticker: "NVDA" }]), true);
  assert.equal(editionHasLockedPlays(null), false);
});

test("decideEditionForceLock skips force when plays exist and overwrite false", () => {
  const d = decideEditionForceLock({ existingPlayCount: 5, overwrite: false });
  assert.equal(d.action, "skip");
  if (d.action === "skip") {
    assert.equal(d.plays_count, 5);
    assert.match(d.reason, /locked/i);
  }
});

test("decideEditionForceLock allows rebuild for recap-only (0 plays)", () => {
  assert.deepEqual(decideEditionForceLock({ existingPlayCount: 0, overwrite: false }), { action: "build" });
});

test("decideEditionForceLock allows overwrite when explicitly requested", () => {
  assert.deepEqual(decideEditionForceLock({ existingPlayCount: 5, overwrite: true }), { action: "build" });
});
