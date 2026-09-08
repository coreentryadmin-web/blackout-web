import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchTier0OriginTickers } from "./tier0-origin-fetch";

test("fetchTier0OriginTickers: success returns tickers without fetchError", async () => {
  const r = await fetchTier0OriginTickers("VECTOR", async () => ["NVDA", "AMD"]);
  assert.deepEqual(r.tickers, ["NVDA", "AMD"]);
  assert.equal(r.fetchError, false);
});

test("fetchTier0OriginTickers: empty success is not fetchError", async () => {
  const r = await fetchTier0OriginTickers("CATALYST", async () => []);
  assert.deepEqual(r.tickers, []);
  assert.equal(r.fetchError, false);
});

test("fetchTier0OriginTickers: thrown fetch sets fetchError and empty tickers", async () => {
  const r = await fetchTier0OriginTickers("POSITIONING", async () => {
    throw new Error("pg pool exhausted");
  });
  assert.deepEqual(r.tickers, []);
  assert.equal(r.fetchError, true);
});
