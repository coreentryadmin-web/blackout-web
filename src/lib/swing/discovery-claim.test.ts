import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldRefuseForceClearRunningClaim,
  SWING_DISCOVERY_SCAN_MAX_MS,
  SWING_FORCE_CLEAR_RUNNING_BUFFER_MS,
} from "./discovery-claim";

const now = 1_700_000_000_000;

test("shouldRefuseForceClearRunningClaim: refuses live running claim inside scan window", () => {
  const claim = { status: "running", at: now - 90_000 };
  assert.equal(shouldRefuseForceClearRunningClaim(claim, now, 120), true);
});

test("shouldRefuseForceClearRunningClaim: allows force when running claim is past scan+buffer", () => {
  const claim = { status: "running", at: now - (SWING_DISCOVERY_SCAN_MAX_MS + SWING_FORCE_CLEAR_RUNNING_BUFFER_MS + 1) };
  assert.equal(shouldRefuseForceClearRunningClaim(claim, now, 60), false);
});

test("shouldRefuseForceClearRunningClaim: allows force for done or absent claims", () => {
  assert.equal(shouldRefuseForceClearRunningClaim({ status: "done", at: now - 5_000 }, now, 3600), false);
  assert.equal(shouldRefuseForceClearRunningClaim(null, now, 0), false);
  assert.equal(shouldRefuseForceClearRunningClaim({ status: "running", at: now - 30_000 }, now, 0), false);
});
