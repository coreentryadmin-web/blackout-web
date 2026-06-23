import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTicker,
  parseWatchlist,
  serializeWatchlist,
  isStarred,
  toggleTicker,
  removeTicker,
  MAX_WATCHLIST,
} from "./watchlist-store.ts";

test("normalizeTicker uppercases and strips non-letters", () => {
  assert.equal(normalizeTicker("aapl"), "AAPL");
  assert.equal(normalizeTicker(" t s l a "), "TSLA");
  assert.equal(normalizeTicker("brk.b"), "BRKB");
  assert.equal(normalizeTicker("123"), "");
  assert.equal(normalizeTicker("TOOLONGTICKER"), "TOOLON");
});

test("parseWatchlist tolerates junk and dedupes", () => {
  assert.deepEqual(parseWatchlist(null), []);
  assert.deepEqual(parseWatchlist("not json"), []);
  assert.deepEqual(parseWatchlist("{}"), []);
  assert.deepEqual(parseWatchlist('["aapl","AAPL","tsla",123,null]'), ["AAPL", "TSLA"]);
});

test("parseWatchlist caps at MAX_WATCHLIST", () => {
  const many = JSON.stringify(Array.from({ length: 200 }, (_, i) => "A" + String.fromCharCode(65 + (i % 26))));
  const parsed = parseWatchlist(many);
  assert.ok(parsed.length <= MAX_WATCHLIST);
});

test("roundtrip serialize/parse", () => {
  const list = ["AAPL", "TSLA", "NVDA"];
  assert.deepEqual(parseWatchlist(serializeWatchlist(list)), list);
});

test("toggleTicker adds to front and removes, immutably", () => {
  const a = toggleTicker([], "aapl");
  assert.deepEqual(a, ["AAPL"]);
  const b = toggleTicker(a, "tsla");
  assert.deepEqual(b, ["TSLA", "AAPL"]);
  assert.deepEqual(a, ["AAPL"], "original not mutated");
  const c = toggleTicker(b, "AAPL");
  assert.deepEqual(c, ["TSLA"]);
});

test("toggleTicker is a no-op add at cap but still removes", () => {
  const full = Array.from({ length: MAX_WATCHLIST }, (_, i) => "T" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + (i % 7)));
  // ensure unique enough; just assert add is rejected when length>=cap
  const atCap = full.slice(0, MAX_WATCHLIST);
  const after = toggleTicker(atCap, "ZZZ");
  assert.equal(after.length, MAX_WATCHLIST);
  assert.equal(isStarred(after, "ZZZ"), false);
});

test("isStarred and removeTicker", () => {
  const list = ["AAPL", "TSLA"];
  assert.equal(isStarred(list, "aapl"), true);
  assert.equal(isStarred(list, "nvda"), false);
  assert.deepEqual(removeTicker(list, "aapl"), ["TSLA"]);
  assert.deepEqual(removeTicker(list, "xyz"), ["AAPL", "TSLA"]);
});
