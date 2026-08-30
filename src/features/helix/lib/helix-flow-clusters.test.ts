import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowAlert } from "@/lib/api";
import { clusterFlowPrints } from "./helix-flow-clusters";

function flow(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker" | "premium">): FlowAlert {
  return {
    option_type: "CALL",
    expiry: "2026-08-29",
    strike: 100,
    direction: "bullish",
    score: 50,
    route: "stock",
    alerted_at: partial.alerted_at ?? "2026-08-29T14:00:00.000Z",
    ...partial,
  };
}

describe("helix-flow-clusters", () => {
  test("merges nearby strikes within window", () => {
    const alerts = [
      flow({ ticker: "NVDA", premium: 400_000, strike: 180, alerted_at: "2026-08-29T14:00:00.000Z" }),
      flow({ ticker: "NVDA", premium: 350_000, strike: 181, alerted_at: "2026-08-29T14:02:00.000Z" }),
      flow({ ticker: "NVDA", premium: 300_000, strike: 182, alerted_at: "2026-08-29T14:04:00.000Z" }),
    ];
    const clusters = clusterFlowPrints(alerts);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.printCount, 3);
    assert.equal(clusters[0]!.totalPremium, 1_050_000);
  });

  test("does not merge across long gap", () => {
    const alerts = [
      flow({ ticker: "NVDA", premium: 400_000, alerted_at: "2026-08-29T14:00:00.000Z" }),
      flow({ ticker: "NVDA", premium: 350_000, alerted_at: "2026-08-29T14:20:00.000Z" }),
    ];
    const clusters = clusterFlowPrints(alerts);
    assert.equal(clusters.length, 0);
  });
});
