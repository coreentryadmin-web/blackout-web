import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLog } from "./log-sanitize";

test("sanitizeForLog strips newlines that could forge a fake log entry", () => {
  const malicious = "TSLA\n2026-01-01 00:00:00 [FATAL] fake admin login succeeded";
  const clean = sanitizeForLog(malicious);
  assert.ok(!clean.includes("\n"), "no raw newline must survive");
  assert.equal(clean, "TSLA 2026-01-01 00:00:00 [FATAL] fake admin login succeeded");
});

test("sanitizeForLog strips carriage returns, tabs, and other control characters", () => {
  assert.equal(sanitizeForLog("a\rb\tc\x00d\x1fe\x7ff"), "a b c d e f");
});

test("sanitizeForLog truncates to the default 200-char cap", () => {
  const long = "x".repeat(500);
  assert.equal(sanitizeForLog(long).length, 200);
});

test("sanitizeForLog respects a custom maxLen", () => {
  assert.equal(sanitizeForLog("abcdefghij", 5), "abcde");
});

test("sanitizeForLog leaves an already-clean value untouched (modulo truncation)", () => {
  assert.equal(sanitizeForLog("TSLA:2026-01-16:CALL:250"), "TSLA:2026-01-16:CALL:250");
});
