import assert from "node:assert/strict";
import { test } from "node:test";

import {
  shouldPersistVectorPickClosure,
  vectorPickClosureCommitKey,
} from "./vector-pick-closure-log";

test("vectorPickClosureCommitKey normalizes ticker and occ", () => {
  assert.equal(vectorPickClosureCommitKey("2026-08-28", "spy", "OCC123"), "2026-08-28:SPY:OCC123");
});

test("shouldPersistVectorPickClosure: only first dont_buy per key", () => {
  assert.equal(shouldPersistVectorPickClosure("dont_buy", false), true);
  assert.equal(shouldPersistVectorPickClosure("dont_buy", true), false);
  assert.equal(shouldPersistVectorPickClosure("still_buy", false), false);
  assert.equal(shouldPersistVectorPickClosure("caution", false), false);
});
