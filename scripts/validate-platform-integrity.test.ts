import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors tier-gate verdict logic in validate-platform-integrity.mjs */
function tierGateStatus(httpStatus: number, passWhen: boolean): "PASS" | "SKIP" | "WARN" {
  if (httpStatus === 401) return "SKIP";
  if (httpStatus === 200 && passWhen) return "PASS";
  return "WARN";
}

/** Vector walls PASS requires both sides populated (auth probe path). */
function vectorWallsStatus(
  httpStatus: number,
  callCount: number,
  putCount: number
): "PASS" | "SKIP" | "WARN" {
  if (httpStatus === 401) return "SKIP";
  if (httpStatus === 200 && callCount > 0 && putCount > 0) return "PASS";
  return "WARN";
}

describe("validate-platform-integrity tier gates", () => {
  it("skips unauthorized premium endpoints instead of warning", () => {
    assert.equal(tierGateStatus(401, false), "SKIP");
    assert.equal(tierGateStatus(401, true), "SKIP");
  });

  it("passes when authed data is present", () => {
    assert.equal(tierGateStatus(200, true), "PASS");
  });

  it("warns on empty authed payloads", () => {
    assert.equal(tierGateStatus(200, false), "WARN");
  });
});

describe("validate-platform-integrity vector walls", () => {
  it("skips when tier-gated", () => {
    assert.equal(vectorWallsStatus(401, 0, 0), "SKIP");
  });

  it("passes when both wall arrays are populated", () => {
    assert.equal(vectorWallsStatus(200, 20, 20), "PASS");
  });

  it("warns when one side is empty", () => {
    assert.equal(vectorWallsStatus(200, 0, 20), "WARN");
    assert.equal(vectorWallsStatus(200, 5, 0), "WARN");
  });
});
