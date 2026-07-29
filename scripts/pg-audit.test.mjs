import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPrivateDbUnreachableError,
  isStaleAuditDbAuthError,
  isPrivateVpcDbUrl,
} from "./pg-audit.mjs";

describe("pg-audit helpers", () => {
  it("detects private RDS unreachable errors", () => {
    assert.equal(isPrivateDbUnreachableError("read ECONNRESET"), true);
    assert.equal(isPrivateDbUnreachableError("connect ETIMEDOUT"), true);
    assert.equal(isPrivateDbUnreachableError("password authentication failed"), false);
  });

  it("detects stale audit DB auth errors", () => {
    assert.equal(
      isStaleAuditDbAuthError('password authentication failed for user "postgres"'),
      true
    );
    assert.equal(isStaleAuditDbAuthError("read ECONNRESET"), false);
  });

  it("detects private VPC RDS proxy URLs", () => {
    assert.equal(
      isPrivateVpcDbUrl("postgres://u:p@blackout-production-proxy.proxy-abc.example.rds.amazonaws.com:5432/db"),
      true
    );
    assert.equal(isPrivateVpcDbUrl("postgres://u:p@proxy.rlwy.net:12345/db"), false);
    assert.equal(isPrivateVpcDbUrl("postgres://postgres:postgres@localhost:5432/blackout"), false);
  });
});
