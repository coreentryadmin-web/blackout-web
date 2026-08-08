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

test("isValidEmail's length check applies to the trimmed value, not the raw one", () => {
  // A genuinely-overlong address must still be rejected...
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.com`), false);
  // ...but padding whitespace around a valid, well-under-254 address must not
  // push the raw length past 254 and cause a false rejection — the length rule
  // is about the actual address, not incidental surrounding whitespace.
  const shortAddress = "trader@example.com";
  const padded = " ".repeat(254 - shortAddress.length + 10) + shortAddress;
  assert.ok(padded.length > 254, "sanity: padded input must exceed 254 raw chars");
  assert.equal(isValidEmail(padded), true);
});
