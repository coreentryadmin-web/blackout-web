import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeHelixSessionPulse } from "./helix-session-pulse.ts";
import type { FlowAlert } from "@/lib/api";

function flow(partial: Partial<FlowAlert> & { premium: number; ticker: string }): FlowAlert {
  return {
    option_type: "CALL",
    alerted_at: new Date().toISOString(),
    ask_pct: 75,
    fill_price: 1,
    open_interest: 0,
    ...partial,
  } as FlowAlert;
}

describe("computeHelixSessionPulse", () => {
  test("aggregates premium, whales, and direction", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({ ticker: "SPX", premium: 2_000_000, option_type: "CALL", ask_pct: 80 }),
        flow({ ticker: "SPX", premium: 300_000, option_type: "PUT", ask_pct: 20 }),
        flow({ ticker: "NVDA", premium: 250_000, option_type: "CALL", ask_pct: 70 }),
      ],
      now
    );
    assert.equal(pulse.printCount, 3);
    assert.equal(pulse.whaleCount, 1);
    assert.equal(pulse.netPremium, 2_000_000 + 250_000 - 300_000);
    assert.equal(pulse.directionRead, "bullish");
    assert.equal(pulse.topTicker?.ticker, "SPX");
  });

  test("counts prints in the last 15 minutes only", () => {
    const now = Date.parse("2026-09-01T15:00:00.000Z");
    const pulse = computeHelixSessionPulse(
      [
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now - 5 * 60_000).toISOString(),
        }),
        flow({
          ticker: "SPY",
          premium: 500_000,
          alerted_at: new Date(now - 20 * 60_000).toISOString(),
        }),
      ],
      now
    );
    assert.equal(pulse.printsLast15m, 1);
  });
});
