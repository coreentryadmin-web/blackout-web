import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAdminSelfGuard,
  parseAdminUserRole,
} from "./admin-users";

test("parseAdminUserRole accepts admin and member", () => {
  assert.equal(parseAdminUserRole("admin"), "admin");
  assert.equal(parseAdminUserRole("member"), "member");
  assert.equal(parseAdminUserRole(""), "member");
  assert.equal(parseAdminUserRole(undefined), "member");
  assert.equal(parseAdminUserRole("superuser"), undefined);
});

test("assertAdminSelfGuard blocks self ban and demote", () => {
  assert.equal(assertAdminSelfGuard("u1", "u2", "ban"), null);
  assert.match(assertAdminSelfGuard("u1", "u1", "ban")!, /cannot ban/i);
  assert.match(assertAdminSelfGuard("u1", "u1", "demote")!, /admin role/i);
});
