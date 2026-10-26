import { before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { isFlowFreshForSpxCohort, markFlowFrameDeliveredForTicker } from "@/lib/flow-liveness";

/**
 * Regression for spx-flow-staleness-market-wide-signal (2026-10-26).
 *
 * `deskFlowDataAgeMs` (spx-desk.ts) clamps a genuinely-stale SPX tape age down to 120_000ms
 * whenever its `flowClusterLive` argument is true. Pre-fix, both call sites computed that
 * argument from `isFlowFrameFreshAnywhere` — true whenever ANY ticker anywhere in the whole
 * market delivered a flow alert in the last 120s, regardless of whether SPX itself was ever
 * involved. Since options flow is delivered somewhere in the market almost continuously during
 * RTH (and often after close), the clamp was effectively always live, which silently disabled
 * both the stale-flow BUY-block (`flowAgeMs > 300_000ms`) and warning (`> 120_000ms`) gates in
 * `spx-play-gates.ts`.
 *
 * This test exercises `deskFlowDataAgeMs` ITSELF (not a reimplementation) with a REAL
 * SPX-cohort-scoped liveness signal (no mocks for flow-liveness — Redis is unconfigured in this
 * sandbox, so sharedCacheGet/Set run their real in-memory fallback), proving the clamp's
 * original INTENT — tolerating real replica-side staleness jitter when SPX's own tape genuinely
 * IS live — is preserved, while the market-wide-signal gap is closed.
 *
 * Mirrors `spx-desk-wall-scope.test.ts`/`spx-desk-data-quality.test.ts`'s established pattern for
 * importing `./spx-desk` as a VALUE (not just a type): mock `server-only` first, then dynamically
 * import so the mock is in place before the module's own top-level imports resolve.
 */

mock.module("server-only", { namedExports: {} });

let deskFlowDataAgeMs: typeof import("./spx-desk").deskFlowDataAgeMs;

before(async () => {
  ({ deskFlowDataAgeMs } = await import("./spx-desk"));
});

const GENUINELY_STALE_MS = 400_000; // ~6.7 min — well past the 300s BUY-block threshold

function staleSpxFlows() {
  return [
    {
      ticker: "SPX",
      premium: 250_000,
      option_type: "call",
      strike: 6000,
      expiry: "2026-10-26",
      direction: "bullish",
      alerted_at: new Date(Date.now() - GENUINELY_STALE_MS).toISOString(),
      alert_rule: null,
      trade_count: 1,
      has_sweep: false,
    },
  ];
}

test("deskFlowDataAgeMs: a genuinely-stale SPX tape is NOT clamped fresh when SPX's own cohort has no corroboration — even though SOME OTHER ticker's flow is market-wide live", async () => {
  // Some OTHER ticker (not SPX/SPXW) delivered a flow alert moments ago — the market-wide pipe
  // is genuinely alive, exactly like the live bug report (confirmed via the real UW tape).
  markFlowFrameDeliveredForTicker("AAPL", Date.now());

  const scopedFlowClusterLive = await isFlowFreshForSpxCohort(120_000);
  assert.equal(
    scopedFlowClusterLive,
    false,
    "SPX's own cohort heartbeat must read NOT live — AAPL is not SPX/SPXW"
  );

  const age = deskFlowDataAgeMs(staleSpxFlows() as any, scopedFlowClusterLive);
  assert.ok(
    age != null && age > 300_000,
    `expected the real stale age (~${GENUINELY_STALE_MS}ms) to survive uncapped, got ${age}`
  );
});

test("deskFlowDataAgeMs: still clamps to 120s when SPX's OWN cohort is genuinely corroborated live (the clamp's real intent, preserved)", async () => {
  markFlowFrameDeliveredForTicker("SPXW", Date.now());

  const scopedFlowClusterLive = await isFlowFreshForSpxCohort(120_000);
  assert.equal(scopedFlowClusterLive, true, "an SPXW print must corroborate the SPX cohort");

  const age = deskFlowDataAgeMs(staleSpxFlows() as any, scopedFlowClusterLive);
  assert.equal(
    age,
    120_000,
    "when SPX's own tape IS genuinely corroborated live, the clamp should still excuse replica-side staleness jitter"
  );
});
