import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeHelixHotTickers } from "./helix-hot-tickers.ts";
import type { FlowAlert } from "@/lib/api";

function flow(ticker: string, premium: number, option_type: "CALL" | "PUT" = "CALL"): FlowAlert {
  return { ticker, premium, option_type, alerted_at: new Date().toISOString() } as FlowAlert;
}

describe("computeHelixHotTickers", () => {
  test("ranks tickers by total premium and caps limit", () => {
    const hot = computeHelixHotTickers(
      [
        flow("NVDA", 1_000_000),
        flow("NVDA", 500_000),
        flow("SPX", 1_200_000),
        flow("TSLA", 100_000, "PUT"),
      ],
      2
    );
    assert.equal(hot.length, 2);
    assert.equal(hot[0]!.ticker, "NVDA");
    assert.equal(hot[0]!.totalPremium, 1_500_000);
    assert.equal(hot[0]!.printCount, 2);
    assert.equal(hot[1]!.ticker, "SPX");
  });
});
