import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors tier-gate verdict logic in validate-platform-integrity.mjs */
function tierGateStatus(httpStatus: number, passWhen: boolean): "PASS" | "SKIP" | "WARN" {
  if (httpStatus === 401) return "SKIP";
  if (httpStatus === 200 && passWhen) return "PASS";
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
