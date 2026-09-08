import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror tierGatedStatus from validate-platform-integrity.mjs (plain .mjs harness).
function tierGatedStatus(httpStatus, passStatus, passDetail, gatedDetail = "tier-gated") {
  if (httpStatus === 401) return { status: "SKIP", detail: gatedDetail };
  return { status: passStatus, detail: passDetail };
}

describe("tierGatedStatus", () => {
  it("maps 401 to SKIP tier-gated", () => {
    const r = tierGatedStatus(401, "PASS", "ignored");
    assert.equal(r.status, "SKIP");
    assert.equal(r.detail, "tier-gated");
  });

  it("preserves pass verdict on 200", () => {
    const r = tierGatedStatus(200, "PASS", "strikes=42");
    assert.equal(r.status, "PASS");
    assert.equal(r.detail, "strikes=42");
  });

  it("preserves warn verdict on 503", () => {
    const r = tierGatedStatus(503, "WARN", "empty matrix");
    assert.equal(r.status, "WARN");
    assert.equal(r.detail, "empty matrix");
  });
});
