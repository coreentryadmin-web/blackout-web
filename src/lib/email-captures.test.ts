import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidEmail } from "./email-captures.ts";

test("isValidEmail accepts ordinary addresses", () => {
  assert.equal(isValidEmail("trader@example.com"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.co.uk"), true);
});

test("isValidEmail rejects missing @ or domain dot", () => {
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("trader@localhost"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail("trader@"), false);
});

test("isValidEmail rejects whitespace-containing input and overlong addresses", () => {
  assert.equal(isValidEmail("trader @example.com"), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.com`), false);
});

test("isValidEmail tolerates surrounding whitespace (trims before checking)", () => {
  assert.equal(isValidEmail("  trader@example.com  "), true);
});
