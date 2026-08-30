import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { helixTapeToCsv, helixTapeToJson } from "./helix-csv-export";
import type { FlowAlert } from "@/lib/api";

function alert(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker" | "premium" | "score">): FlowAlert {
  return {
    option_type: "CALL",
    expiry: "2026-08-29",
    strike: 100,
    direction: "bullish",
    route: "stock",
    alerted_at: "2026-08-29T14:00:00.000Z",
    ...partial,
  };
}

describe("helix-csv-export", () => {
  test("helixTapeToCsv includes score tier columns", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      alert({ ticker: "NVDA", premium: 500_000 + i * 50_000, score: 20 + i * 8 })
    );
    const csv = helixTapeToCsv(rows, "minPremium=200k");
    assert.match(csv, /# filters: minPremium=200k/);
    assert.match(csv, /ScoreTier/);
    assert.match(csv, /NVDA/);
  });

  test("helixTapeToJson attaches score_context", () => {
    const rows = [alert({ ticker: "SPY", premium: 1_000_000, score: 85 })];
    const json = JSON.parse(helixTapeToJson(rows)) as Array<{ score_context: { tier: string } }>;
    assert.equal(json[0]?.score_context.tier, "rare");
  });
});
