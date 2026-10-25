import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtShares } from "./DarkPoolPanel";

test("fmtShares formats under 1K and under 1M plainly", () => {
  assert.equal(fmtShares(500), "500");
  assert.equal(fmtShares(125_000), "125K");
});

test("fmtShares promotes a share count that rounds to 1000K into 1.0M, never an overflowed label", () => {
  assert.equal(fmtShares(999_600), "1.0M");
  assert.equal(fmtShares(999_999), "1.0M");
  assert.equal(fmtShares(999_499), "999K");
});
