import { test } from "node:test";
import assert from "node:assert/strict";
import { vectorTickersFromLeaderRows } from "./vector-screen";

test("vectorTickersFromLeaderRows: dedupes, uppercases, respects cap", () => {
  const tickers = vectorTickersFromLeaderRows(
    [{ ticker: "nvda" }, { ticker: "NVDA" }, { ticker: "amd" }, { ticker: "tsla" }],
    2,
  );
  assert.deepEqual(tickers, ["NVDA", "AMD"]);
});
