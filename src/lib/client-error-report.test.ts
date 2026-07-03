import assert from "node:assert/strict";
import test from "node:test";
import { clampString, validateClientErrorBody, MAX_FIELD_LEN } from "./client-error-report";

test("clampString: trims, rejects non-strings and blank/whitespace-only input", () => {
  assert.equal(clampString("  hi  ", 10), "hi");
  assert.equal(clampString("", 10), null);
  assert.equal(clampString("   ", 10), null);
  assert.equal(clampString(42, 10), null);
  assert.equal(clampString(null, 10), null);
  assert.equal(clampString(undefined, 10), null);
});

test("clampString: truncates to max length after trimming", () => {
  assert.equal(clampString("abcdefgh", 4), "abcd");
});

test("validateClientErrorBody: rejects a missing or empty message", () => {
  assert.equal(validateClientErrorBody({}), null);
  assert.equal(validateClientErrorBody({ message: "" }), null);
  assert.equal(validateClientErrorBody({ message: 123 }), null);
});

test("validateClientErrorBody: accepts message-only, defaults name to Error, nulls the rest", () => {
  const v = validateClientErrorBody({ message: "boom" });
  assert.deepEqual(v, { message: "boom", stack: null, name: "Error", scope: null });
});

test("validateClientErrorBody: carries stack/name/url through when present", () => {
  const v = validateClientErrorBody({
    message: "TypeError: x is not a function",
    stack: "at foo (bar.js:1:1)",
    name: "TypeError",
    url: "/grid",
  });
  assert.deepEqual(v, {
    message: "TypeError: x is not a function",
    stack: "at foo (bar.js:1:1)",
    name: "TypeError",
    scope: "/grid",
  });
});

test("validateClientErrorBody: an oversized message/stack is clamped, never rejected", () => {
  const huge = "x".repeat(MAX_FIELD_LEN + 500);
  const v = validateClientErrorBody({ message: huge, stack: huge });
  assert.equal(v?.message.length, MAX_FIELD_LEN);
  assert.equal(v?.stack?.length, MAX_FIELD_LEN);
});

test("validateClientErrorBody: a full URL with a query-string secret is reduced to path-only — never trust the client on a public endpoint", () => {
  const v = validateClientErrorBody({ message: "e", url: "https://blackouttrades.com/grid?token=SECRET#frag" });
  assert.equal(v?.scope, "/grid");
  assert.ok(!v?.scope?.includes("SECRET"));
});

test("validateClientErrorBody: a bare path with query/hash is also stripped to path-only", () => {
  assert.equal(validateClientErrorBody({ message: "e", url: "/dashboard?x=1" })?.scope, "/dashboard");
  assert.equal(validateClientErrorBody({ message: "e", url: "/nighthawk#section" })?.scope, "/nighthawk");
});

test("validateClientErrorBody: a scheme with no path segment reduces to root", () => {
  assert.equal(validateClientErrorBody({ message: "e", url: "https://blackouttrades.com" })?.scope, "/");
});
