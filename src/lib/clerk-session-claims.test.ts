import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  roleFromSessionClaims,
  sessionClaimsHaveAuthFields,
  tierFromSessionClaims,
} from "./clerk-session-claims";

describe("clerk-session-claims", () => {
  it("detects configured auth fields", () => {
    assert.equal(sessionClaimsHaveAuthFields(null), false);
    assert.equal(sessionClaimsHaveAuthFields({}), false);
    assert.equal(sessionClaimsHaveAuthFields({ tier: "premium" }), true);
    assert.equal(sessionClaimsHaveAuthFields({ role: "admin" }), true);
  });

  it("parses tier from claims", () => {
    assert.equal(tierFromSessionClaims(undefined), null);
    assert.equal(tierFromSessionClaims({ foo: "bar" }), null);
    assert.equal(tierFromSessionClaims({ tier: "premium" }), "premium");
    assert.equal(tierFromSessionClaims({ tier: "" }), "free");
  });

  it("parses role from claims", () => {
    assert.equal(roleFromSessionClaims(undefined), null);
    assert.equal(roleFromSessionClaims({ tier: "free" }), null);
    assert.equal(roleFromSessionClaims({ role: "admin" }), "admin");
    assert.equal(roleFromSessionClaims({ role: "" }), "member");
    assert.equal(roleFromSessionClaims({ role: null }), "member");
  });
});
