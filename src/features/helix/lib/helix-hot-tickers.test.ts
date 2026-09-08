import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeHelixHotTickers } from "./helix-hot-tickers.ts";
import { directionTone } from "./helix-direction-read.ts";
import type { FlowAlert } from "@/lib/api";

function flow(
  ticker: string,
  premium: number,
  option_type: "CALL" | "PUT" = "CALL",
  ask_pct?: number
): FlowAlert {
  return { ticker, premium, option_type, ask_pct, alerted_at: new Date().toISOString() } as FlowAlert;
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

  test("direction is aggression-aware, not the raw callPremium - putPremium sign — a ticker that's 100% SOLD calls reads bearish, not bullish", () => {
    // All-CALL, all sold (ask_pct 20 <= ASK_SIDE_SOLD_PCT). Raw sign (calls - puts > 0) would read
    // bullish; the correct aggression-aware read is bearish (a sold call is bearish) — exactly the
    // #2691 rule NetPremiumLeaderboard/ExpiryConcentration already use.
    const hot = computeHelixHotTickers([
      flow("NVDA", 1_000_000, "CALL", 20),
      flow("NVDA", 2_000_000, "CALL", 15),
    ]);
    assert.equal(hot[0]!.ticker, "NVDA");
    assert.equal(hot[0]!.callPremium, 3_000_000);
    assert.equal(hot[0]!.putPremium, 0);
    assert.equal(hot[0]!.direction.label, "bearish");
    assert.equal(directionTone(hot[0]!.direction), "bear");
  });

  test("a mostly-unreadable ticker (no ask_pct) renders no direction tone, not a guessed one", () => {
    const hot = computeHelixHotTickers([flow("SPX", 4_000_000_000, "CALL")]);
    assert.equal(hot[0]!.direction.label, "undetermined");
    assert.equal(directionTone(hot[0]!.direction), null);
  });
});
