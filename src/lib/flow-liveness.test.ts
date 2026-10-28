import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  flowHeartbeatAgeMs,
  isFlowFrameFreshAnywhere,
  isFlowFreshForSpxCohort,
  isSpxFlowCohortTicker,
  markFlowFrameDeliveredForTicker,
} from "./flow-liveness";

describe("flowHeartbeatAgeMs", () => {
  const now = 1_700_000_000_000;

  test("returns age for a normal past timestamp", () => {
    assert.equal(flowHeartbeatAgeMs(now - 30_000, now), 30_000);
  });

  test("returns null for a far-future timestamp (would falsely read fresh)", () => {
    assert.equal(flowHeartbeatAgeMs(now + 5 * 60_000, now), null);
  });

  test("allows small clock skew within tolerance", () => {
    assert.equal(flowHeartbeatAgeMs(now + 30_000, now), -30_000);
  });
});

describe("isSpxFlowCohortTicker", () => {
  test("SPX and SPXW (any case) are the cohort", () => {
    assert.equal(isSpxFlowCohortTicker("SPX"), true);
    assert.equal(isSpxFlowCohortTicker("spxw"), true);
  });

  test("every other ticker is NOT the cohort", () => {
    assert.equal(isSpxFlowCohortTicker("AAPL"), false);
    assert.equal(isSpxFlowCohortTicker("SPY"), false);
  });
});

// Regression for spx-flow-staleness-market-wide-signal (2026-10-26): deskFlowDataAgeMs's
// clamp used to trust isFlowFrameFreshAnywhere, which is true whenever ANY ticker anywhere
// in the market delivered a flow frame recently — it cannot tell "SPX's own tape is
// corroborated" apart from "some unrelated name's flow is live". These tests exercise the
// REAL functions (no mocks — Redis is unconfigured in this sandbox, so sharedCacheGet/Set
// run their real in-memory fallback) to prove the new SPX-cohort-scoped signal actually
// tells the two cases apart, unlike the market-wide one it replaces at spx-desk.ts's call
// sites.
describe("isFlowFreshForSpxCohort vs isFlowFrameFreshAnywhere — market-wide signal cannot stand in for SPX's own corroboration", () => {
  test("some OTHER ticker's fresh flow reads live market-wide but NOT for the SPX cohort", async () => {
    // Simulates the exact live bug report: AAPL (or any non-SPX name) had a flow alert
    // persisted moments ago, so the market-wide pipe is genuinely alive —
    const now = Date.now();
    markFlowFrameDeliveredForTicker("AAPL", now);

    // Market-wide signal: correctly still true (this consumer — cluster health, admin
    // dashboards — is intentionally unscoped and must be unaffected by this fix).
    assert.equal(await isFlowFrameFreshAnywhere(120_000), true);

    // SPX-cohort signal: must be false — AAPL is not SPX/SPXW, so SPX's own tape has NO
    // real corroboration here. Pre-fix this function did not exist at all; post-fix it
    // must report the scoped truth rather than silently reusing the market-wide heartbeat.
    assert.equal(await isFlowFreshForSpxCohort(120_000), false);
  });

  test("an SPX (or SPXW) print makes the SPX-cohort signal live too", async () => {
    const now = Date.now();
    markFlowFrameDeliveredForTicker("SPXW", now);
    assert.equal(await isFlowFreshForSpxCohort(120_000), true);
  });
});
