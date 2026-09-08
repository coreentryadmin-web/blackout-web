import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlayStatus } from "./plan";

test("derivePlayStatus: 300% frozen target does not TRIM at +120% peak", () => {
  const entry = 1.0;
  const peak = 2.2; // +120%
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 2.1,
    peak,
    trough: 0.9,
    nowEtMinutes: 12 * 60,
    targetPct: 300,
  });
  assert.equal(s.status, "HOLD");
});

test("derivePlayStatus: default +100% target still TRIMs at double", () => {
  const entry = 1.0;
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 2.0,
    peak: 2.0,
    trough: 0.9,
    nowEtMinutes: 12 * 60,
  });
  assert.equal(s.status, "TRIM");
});
