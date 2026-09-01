import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowAlert } from "@/lib/api";
import { computeSessionFlowCorrelations } from "./helix-session-correlation";

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

describe("helix-session-correlation", () => {
  test("detects SPY leader followed by QQQ within 5 min", () => {
    const alerts = [
      flow({ ticker: "SPY", premium: 1e6, ask_pct: 85, alerted_at: "2026-08-29T14:00:00.000Z" }),
      flow({ ticker: "SPY", premium: 1e6, ask_pct: 85, alerted_at: "2026-08-29T14:10:00.000Z" }),
      flow({ ticker: "QQQ", premium: 800_000, ask_pct: 80, alerted_at: "2026-08-29T14:02:00.000Z" }),
      flow({ ticker: "QQQ", premium: 800_000, ask_pct: 80, alerted_at: "2026-08-29T14:11:00.000Z" }),
    ];
    const pairs = computeSessionFlowCorrelations(alerts, { lags: [5] });
    const hit = pairs.find((p) => p.leader === "SPY" && p.follower === "QQQ" && p.lagMin === 5);
    assert.ok(hit);
    assert.equal(hit!.followerHits, 2);
    assert.equal(hit!.rate, 1);
  });

  test("returns empty when too few tickers", () => {
    assert.deepEqual(computeSessionFlowCorrelations([]), []);
  });

  test("a larger lag window never scores FEWER hits than a smaller one (monotonicity)", () => {
    // Two SPY leader prints, each followed 3 minutes later by a same-direction QQQ print — both
    // pairs are well within all three default lag windows (5/10/15 min), so every lag should
    // report the same 2 hits. A 15-min window is a strict SUPERSET of a 5-min window, so it can
    // only match equal or more hits, never fewer, for a correct implementation.
    const alerts = [
      flow({ ticker: "SPY", premium: 1e6, ask_pct: 85, alerted_at: "2026-08-29T14:00:00.000Z" }),
      flow({ ticker: "QQQ", premium: 800_000, ask_pct: 80, alerted_at: "2026-08-29T14:03:00.000Z" }),
      flow({ ticker: "SPY", premium: 1e6, ask_pct: 85, alerted_at: "2026-08-29T14:20:00.000Z" }),
      flow({ ticker: "QQQ", premium: 800_000, ask_pct: 80, alerted_at: "2026-08-29T14:23:00.000Z" }),
    ];
    const pairs = computeSessionFlowCorrelations(alerts);
    const byLag = new Map(
      pairs.filter((p) => p.leader === "SPY" && p.follower === "QQQ").map((p) => [p.lagMin, p]),
    );
    // Regression: a stale two-pointer index shared across lag passes (rather than reset per
    // lag) made the 10-min and 15-min passes start their follower search from wherever the
    // 5-min pass left off — missing prints that occurred earlier in time. Pre-fix this reported
    // followerHits=2 at lag=5 but only 1 at lag=10 and lag=15.
    assert.equal(byLag.get(5)?.followerHits, 2);
    assert.equal(byLag.get(10)?.followerHits, 2);
    assert.equal(byLag.get(15)?.followerHits, 2);
  });
});
