import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRow } from "./route";

test("a print upstream did not date arrives with NO time, not with now", () => {
  // The whole point. `new Date().toISOString()` is not a default — it is a measurement nobody
  // took, and it lands in the worst possible direction: newest on the tape, "just now" on screen,
  // and inside every open COORD window.
  const row = normalizeRow({ ticker: "PLTR", premium: 500_000, size: 1000 });
  assert.equal(row?.executed_at, null);
});

test("an empty-string time is absence too, not a parseable value", () => {
  assert.equal(normalizeRow({ ticker: "PLTR", premium: 500_000, executed_at: "" })?.executed_at, null);
  assert.equal(normalizeRow({ ticker: "PLTR", premium: 500_000, executed_at: "   " })?.executed_at, null);
});

test("a real upstream time passes through untouched, from any of the three field names", () => {
  const at = "2026-08-21T23:59:52Z";
  assert.equal(normalizeRow({ ticker: "PLTR", premium: 1, executed_at: at })?.executed_at, at);
  assert.equal(normalizeRow({ ticker: "PLTR", premium: 1, date: at })?.executed_at, at);
  assert.equal(normalizeRow({ ticker: "PLTR", premium: 1, timestamp: at })?.executed_at, at);
});

test("normalizing the same undated row twice gives the same answer", () => {
  // serverCache caches the RAW upstream rows and normalizeRow runs per request, so a fabricated
  // stamp differed on every fetch — which is why a dark-pool deep link (keyed on
  // executed_at.slice(0, 19)) could never match the print it was built from.
  const raw = { ticker: "PLTR", premium: 500_000 };
  assert.equal(normalizeRow(raw)?.executed_at, normalizeRow(raw)?.executed_at);
});

test("side still collapses to buy/sell/neutral and a row without a ticker or premium is dropped", () => {
  assert.equal(normalizeRow({ ticker: "X", premium: 1, side: "BUY" })?.side, "buy");
  assert.equal(normalizeRow({ ticker: "X", premium: 1, sentiment: "sell side" })?.side, "sell");
  assert.equal(normalizeRow({ ticker: "X", premium: 1 })?.side, "neutral");
  assert.equal(normalizeRow({ premium: 1 }), null);
  assert.equal(normalizeRow({ ticker: "X", premium: 0 }), null);
  assert.equal(normalizeRow(null), null);
});
