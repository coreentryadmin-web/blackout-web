import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeClerkUserIdFromSessionCookie,
  decodeClerkSessionJwtPayload,
} from "./clerk-session-jwt";

function b64url(json: string): string {
  return Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function jwt(payload: Record<string, unknown>): string {
  return `header.${b64url(JSON.stringify(payload))}.sig`;
}

test("decodeClerkSessionJwtPayload: parses base64url payload", () => {
  const token = jwt({ sub: "user_abc", exp: 9_999_999_999, sts: "active" });
  assert.deepEqual(decodeClerkSessionJwtPayload(token), {
    sub: "user_abc",
    exp: 9_999_999_999,
    sts: "active",
  });
});

test("activeClerkUserIdFromSessionCookie: active unexpired session returns sub", () => {
  const token = jwt({
    sub: "user_3GgzCsjUfB1sx5SKCMSY618UYpa",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sts: "active",
  });
  assert.equal(activeClerkUserIdFromSessionCookie(token), "user_3GgzCsjUfB1sx5SKCMSY618UYpa");
});

test("activeClerkUserIdFromSessionCookie: expired token returns null", () => {
  const token = jwt({
    sub: "user_x",
    exp: Math.floor(Date.now() / 1000) - 60,
    sts: "active",
  });
  assert.equal(activeClerkUserIdFromSessionCookie(token), null);
});

test("activeClerkUserIdFromSessionCookie: pending sts returns null", () => {
  const token = jwt({
    sub: "user_x",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sts: "pending",
  });
  assert.equal(activeClerkUserIdFromSessionCookie(token), null);
});

test("activeClerkUserIdFromSessionCookie: missing sts treated as active (backwards compat)", () => {
  const token = jwt({
    sub: "user_y",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  assert.equal(activeClerkUserIdFromSessionCookie(token), "user_y");
});

test("activeClerkUserIdFromSessionCookie: malformed token returns null", () => {
  assert.equal(activeClerkUserIdFromSessionCookie("not-a-jwt"), null);
  assert.equal(activeClerkUserIdFromSessionCookie(null), null);
  assert.equal(activeClerkUserIdFromSessionCookie(undefined), null);
  assert.equal(activeClerkUserIdFromSessionCookie(""), null);
});
