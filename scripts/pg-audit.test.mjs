import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPrivateDbUnreachableError,
  isStaleAuditDbAuthError,
  describeConnectError,
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

describe("describeConnectError", () => {
  // ── describeConnectError ────────────────────────────────────────────────────────────────────
// These exist because the cron audit failed every scheduled run logging
// `Postgres connect failed: ` with NOTHING after the colon: `.message` was empty, so the log was
// useless AND the message-matching classifiers silently disabled the watchdog fallback.

  it("describeConnectError never returns an empty string", () => {
  // The exact failure: an error carrying no message at all.
  assert.equal(describeConnectError(new Error("")), "Error with no message");
  assert.equal(describeConnectError({}), "Object with no message");
  assert.equal(describeConnectError(null), "object with no message");
  assert.equal(describeConnectError(undefined), "undefined with no message");
  });

  it("describeConnectError unwraps AggregateError, where dual-stack dialling hides the reason", () => {
  const agg = new AggregateError(
    [Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" })],
    ""
  );
  const out = describeConnectError(agg);
  assert.match(out, /ECONNREFUSED/);
  // ...and the result is classifiable again, which is what re-enables the fallback.
  assert.equal(isPrivateDbUnreachableError(out), true);
  });

  it("describeConnectError follows the cause chain, where TLS failures hide", () => {
  const err = new Error("");
  err.cause = Object.assign(new Error("self signed certificate in certificate chain"), {
    code: "SELF_SIGNED_CERT_IN_CHAIN",
  });
  const out = describeConnectError(err);
  assert.match(out, /self signed certificate/);
  assert.equal(isPrivateDbUnreachableError(out), true);
  });

  it("describeConnectError uses a bare code when there is no message", () => {
  assert.equal(describeConnectError(Object.assign(new Error(""), { code: "ETIMEDOUT" })), "ETIMEDOUT");
  });

  it("describeConnectError does not loop on a self-referencing cause", () => {
  const a = new Error("outer");
  a.cause = a;
  assert.equal(describeConnectError(a), "outer");
  });

  it("isPrivateDbUnreachableError covers the unreachable-network codes", () => {
  for (const m of ["EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "certificate has expired"]) {
    assert.equal(isPrivateDbUnreachableError(m), true, m);
  }
  assert.equal(isPrivateDbUnreachableError("relation does not exist"), false);
  });
});
