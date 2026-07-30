import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isClerkPhoneCollision,
  isClerkEmailCollision,
} from "./clerk-audit-user.mjs";

test("isClerkPhoneCollision detects phone-already-associated errors", () => {
  assert.equal(
    isClerkPhoneCollision([
      { message: "This phone number is already associated with an existing account." },
    ]),
    true
  );
  assert.equal(isClerkPhoneCollision([{ code: "form_identifier_exists", meta: { param_name: "phone_number" } }]), true);
  assert.equal(isClerkPhoneCollision([{ code: "form_identifier_exists" }]), false);
});

test("isClerkEmailCollision detects form_identifier_exists", () => {
  assert.equal(isClerkEmailCollision([{ code: "form_identifier_exists" }]), true);
  assert.equal(
    isClerkPhoneCollision([{ message: "This phone number is already associated with an existing account." }]),
    true
  );
});
