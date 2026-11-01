import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTelemetryBody, sanitizeTelemetrySnippet } from "./api-telemetry-sanitize";

// Root cause: the previous redaction regexes used a bare `[^"]*` (or `[^']*`) to consume a JSON
// string value, which stops at the FIRST quote character it meets — including an escaped quote
// (`\"`) still inside the value. A credential value containing a literal embedded quote (e.g. a
// user-chosen password, or any secret that happens to contain one) therefore leaked everything
// after that escaped quote, up to the real closing quote, in plaintext.

test("sanitizeTelemetryBody: fully redacts a credential value containing an escaped double quote (regression for partial-leak bug)", () => {
  const body = String.raw`{"api_key":"sk-abc\"def-secret-tail"}`;
  const out = sanitizeTelemetryBody(body);
  // Before the fix this was `{"api_key":"[REDACTED]"def-secret-tail"}` — the tail of the real
  // secret ("def-secret-tail") survived redaction in plaintext.
  assert.equal(out, `{"api_key":"[REDACTED]"}`);
  assert.ok(!out!.includes("def-secret-tail"), "no fragment of the real secret must survive");
});

test("sanitizeTelemetryBody: still redacts a plain credential value with no embedded quote", () => {
  const body = `{"api_key":"sk-plain-secret-value"}`;
  const out = sanitizeTelemetryBody(body);
  assert.equal(out, `{"api_key":"[REDACTED]"}`);
});

test("sanitizeTelemetryBody: redacts a password value containing an escaped quote", () => {
  const body = String.raw`{"password":"p@ss\"word-tail"}`;
  const out = sanitizeTelemetryBody(body);
  assert.equal(out, `{"password":"[REDACTED]"}`);
  assert.ok(!out!.includes("word-tail"));
});

test("sanitizeTelemetrySnippet: fully redacts a double-quoted secret containing an escaped quote", () => {
  const snippet = String.raw`{"token":"tok_abc\"leaked-tail"}`;
  const out = sanitizeTelemetrySnippet(snippet);
  assert.equal(out, `{"token":"[REDACTED]"}`);
  assert.ok(!out!.includes("leaked-tail"));
});

test("sanitizeTelemetrySnippet: fully redacts a single-quoted secret containing an escaped quote", () => {
  const snippet = String.raw`{'secret':'abc\'leaked-tail'}`;
  const out = sanitizeTelemetrySnippet(snippet);
  assert.equal(out, `{'secret':'[REDACTED]'}`);
  assert.ok(!out!.includes("leaked-tail"));
});

test("sanitizeTelemetrySnippet: still redacts a plain (unescaped) double-quoted secret", () => {
  const snippet = `{"secret":"plain-value-here"}`;
  const out = sanitizeTelemetrySnippet(snippet);
  assert.equal(out, `{"secret":"[REDACTED]"}`);
});

test("sanitizeTelemetrySnippet: Bearer and JWT patterns unaffected by the quote-escape fix", () => {
  const snippet = "Authorization: Bearer abc.def.ghi";
  assert.equal(sanitizeTelemetrySnippet(snippet), "Authorization: Bearer [REDACTED]");
});
