import { test } from "node:test";
import assert from "node:assert/strict";
import { morningStatusFromDb } from "./morning-status-from-db";
import { MORNING_VERDICT_VERSION } from "./morning-verdict-persist";

test("morningStatusFromDb: rebuilds status from durable outcome pins", () => {
  const result = morningStatusFromDb({
    editionFor: "2026-08-07",
    editionPlays: [
      { rank: 1, ticker: "NVDA", direction: "LONG" },
      { rank: 2, ticker: "AMD", direction: "LONG" },
    ],
    outcomeRows: [
      {
        ticker: "NVDA",
        morning_verdict: {
          verdict_version: MORNING_VERDICT_VERSION,
          status: "CONFIRMED",
          reason: "All checks passed",
          checked_at: "2026-08-07T13:16:00.000Z",
          metrics: {
            stock_premarket: 125.5,
            spx_premarket: 5400,
            spx_prior_close: 5380,
            overnight_gap_pts: 20,
            overnight_gap_pct: 0.37,
            regime: "risk_on",
          },
        },
      },
      {
        ticker: "AMD",
        morning_verdict: {
          verdict_version: MORNING_VERDICT_VERSION,
          status: "INVALIDATED",
          reason: "Gapped through stop",
          checked_at: "2026-08-07T13:16:00.000Z",
          metrics: { regime: "risk_on" },
        },
      },
    ],
  });

  assert.ok(result);
  assert.equal(result!.edition_for, "2026-08-07");
  assert.equal(result!.checked_at, "2026-08-07T13:16:00.000Z");
  assert.equal(result!.regime, "risk_on");
  assert.equal(result!.overnight_gap_pts, 20);
  assert.equal(result!.plays.length, 2);
  assert.equal(result!.plays[0]!.ticker, "NVDA");
  assert.equal(result!.plays[0]!.status, "CONFIRMED");
  assert.equal(result!.plays[0]!.checked_at, "2026-08-07T13:16:00.000Z");
  assert.equal(result!.plays[1]!.status, "INVALIDATED");
  assert.equal(result!.summary.confirmed, 1);
  assert.equal(result!.summary.invalidated, 1);
});

test("morningStatusFromDb: returns null when no readable verdicts exist", () => {
  assert.equal(
    morningStatusFromDb({
      editionFor: "2026-08-07",
      editionPlays: [{ rank: 1, ticker: "NVDA", direction: "LONG" }],
      outcomeRows: [{ ticker: "NVDA", morning_verdict: null }],
    }),
    null
  );
});
