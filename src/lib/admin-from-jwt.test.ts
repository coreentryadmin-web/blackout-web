import { test } from "node:test";
import assert from "node:assert/strict";
import { adminFromJwtRole } from "./admin-from-jwt";

test("adminFromJwtRole short-circuits admin and member without network", () => {
  assert.equal(adminFromJwtRole("admin"), true);
  assert.equal(adminFromJwtRole("member"), false);
});

test("adminFromJwtRole returns null when role claim is absent (Clerk fallback)", () => {
  assert.equal(adminFromJwtRole(null), null);
});
