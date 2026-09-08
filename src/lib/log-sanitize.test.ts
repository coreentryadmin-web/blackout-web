import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForLog } from "./log-sanitize";

test("sanitizeForLog escapes newlines that could forge a fake log entry — no raw newline survives", () => {
  const malicious = "TSLA\n2026-01-01 00:00:00 [FATAL] fake admin login succeeded";
  const clean = sanitizeForLog(malicious);
  assert.ok(!clean.includes("\n"), "no raw newline must survive in the output");
  assert.ok(clean.includes("\\n"), "the newline must survive only as an escaped, literal \\n sequence");
});

test("sanitizeForLog output round-trips through JSON.parse to the original (truncated) value — proves it's real JSON.stringify escaping, not a lossy regex", () => {
  const value = "a\r\nb\tc\x00d";
  assert.equal(JSON.parse(sanitizeForLog(value)), value);
});

test("sanitizeForLog wraps the value in quotes, marking it in log output as an escaped caller-supplied value", () => {
  const clean = sanitizeForLog("TSLA:2026-01-16:CALL:250");
  assert.ok(clean.startsWith('"') && clean.endsWith('"'));
});

test("sanitizeForLog truncates BEFORE escaping, to the default 200-char cap on the raw input", () => {
  const long = "x".repeat(500);
  const clean = sanitizeForLog(long);
  assert.equal(JSON.parse(clean).length, 200);
});

test("sanitizeForLog respects a custom maxLen", () => {
  assert.equal(JSON.parse(sanitizeForLog("abcdefghij", 5)), "abcde");
});
