import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowAlert } from "@/lib/api";
import { clusterFlowPrints, HELIX_FLOW_CLUSTER_STRIKE_TOL_PCT } from "./helix-flow-clusters";

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

  // BUG FIXED: the merge check used to test a candidate print against the cluster's premium-
  // weighted RUNNING AVERAGE strike (which drifts every time a print merges in), not against a
  // fixed anchor. A chain of individually-"near" steps could then walk the cluster's strike
  // arbitrarily far from where it started, as long as each new print stayed within tolerance of
  // wherever the average had drifted to. Reproduced with spot=1000 (HELIX_FLOW_CLUSTER_STRIKE_
  // TOL_PCT=2% => a ~20pt band) and strikes stepping ~19pts apart with front-loaded premium
  // weighting (each premium ~1000x the cluster's cumulative total so far, pulling the running
  // average onto the latest strike every time): all 12 prints merged into ONE reported
  // "campaign" spanning strike 1000 to strike 1209 — a 209pt (~21%) spread presented as a single
  // same-strike repeated-fill story, more than 10x the stated tolerance. Fixed by comparing every
  // candidate against the cluster's fixed founding strike instead of its drifting average.
  test("does not chain strikes far beyond tolerance via a drifting running average", () => {
    const spot = 1000;
    const strikes: number[] = [];
    for (let i = 0; i < 12; i += 1) strikes.push(1000 + i * 19); // each step ~19 < 20pt tolerance
    let premium = 1;
    const alerts = strikes.map((strike, i) => {
      const thisPremium = premium;
      premium *= 1000; // next premium dwarfs the cumulative total so far
      return flow({
        ticker: "SPY",
        premium: thisPremium,
        strike,
        underlying_price: spot,
        alerted_at: new Date(Date.parse("2026-08-29T14:00:00.000Z") + i * 1000).toISOString(),
      });
    });

    const clusters = clusterFlowPrints(alerts, { minSize: 2 });

    // Direct, unambiguous assertion on the bug: no single cluster may span the full 0..209
    // range. With the fix, the maximum printCount per cluster is 2 for this input (each step is
    // too far from the one two steps back to join a 3rd time).
    for (const c of clusters) {
      assert.ok(
        c.printCount <= 2,
        `cluster at strike ${c.strike} merged ${c.printCount} prints — strikes chained far beyond the ${HELIX_FLOW_CLUSTER_STRIKE_TOL_PCT * 100}% tolerance`
      );
    }
    assert.ok(clusters.length >= 4, "expected several small clusters, not one giant chained one");
  });
});
