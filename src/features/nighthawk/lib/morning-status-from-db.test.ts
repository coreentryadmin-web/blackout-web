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

// Task #32 (Ask Largo x Night Hawk Legacy standing mandate, 2026-09-18): the live cron's Redis
// path can carry the desk playbook sentence (regime's authored strategy line), but
// morning_verdict.metrics never persisted it (only regime/spx_premarket/spx_prior_close/
// overnight_gap_pts are pinned there) -- so this DB-fallback reconstruction honestly reports it
// as unavailable, same convention already used for gex_bias/call_wall/put_wall below.
test("morningStatusFromDb: playbook is honestly null (never fabricated) -- not recoverable from morning_verdict.metrics", () => {
  const result = morningStatusFromDb({
    editionFor: "2026-08-07",
    editionPlays: [{ rank: 1, ticker: "NVDA", direction: "LONG" }],
    outcomeRows: [
      {
        ticker: "NVDA",
        morning_verdict: {
          verdict_version: MORNING_VERDICT_VERSION,
          status: "CONFIRMED",
          reason: "All checks passed",
          checked_at: "2026-08-07T13:16:00.000Z",
          metrics: { regime: "risk_on" },
        },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result!.playbook, null);
  assert.equal(result!.gex_bias, null);
  assert.equal(result!.call_wall, null);
  assert.equal(result!.put_wall, null);
});

// 2026-09-13 finding: the live cron (nighthawk-morning-confirm/route.ts's
// `plays.map((play) => ...)`) always emits ONE PlayStatus per edition play, using
// UNVERIFIED as the honest "could not check this one" status when a per-ticker
// verdict is missing (morning-confirm-verdict.ts's "zero checks ran" branch). This DB
// fallback (used once the 24h Redis cache expires) used to silently DROP any edition
// play lacking a pinned morning_verdict instead — a member polling after the TTL
// window would see fewer plays than the edition actually publishes.
test("morningStatusFromDb: a play with no pinned verdict still appears, as UNVERIFIED — never silently dropped", () => {
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
          metrics: { regime: "risk_on" },
        },
      },
      // AMD never got a pinned verdict (e.g. a per-ticker Cortex/data error).
      { ticker: "AMD", morning_verdict: null },
    ],
  });

  assert.ok(result);
  assert.equal(result!.plays.length, 2, "both edition plays must appear, not just the pinned one");
  const amd = result!.plays.find((p) => p.ticker === "AMD");
  assert.ok(amd, "AMD must not be silently dropped from the reconstructed status list");
  assert.equal(amd!.status, "UNVERIFIED");
  assert.equal(result!.summary.unverified, 1);
  assert.equal(result!.summary.confirmed, 1);
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
