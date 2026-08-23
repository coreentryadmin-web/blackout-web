import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countMatchingContractHits,
  formatHitsInWindow,
  HELIX_STRIKE_HITS_WINDOW_MIN,
  HELIX_STRIKE_HITS_WINDOW_MS,
} from "./helix-strike-leaders";

test("formatHitsInWindow pluralizes hits", () => {
  assert.equal(formatHitsInWindow(1), `1 hit in last ${HELIX_STRIKE_HITS_WINDOW_MIN} min`);
  assert.equal(formatHitsInWindow(3), `3 hits in last ${HELIX_STRIKE_HITS_WINDOW_MIN} min`);
});

test("countMatchingContractHits matches MM/DD/YYYY expiry variants", () => {
  const nowMs = Date.parse("2026-07-20T16:00:00.000Z");
  const alerts = [
    {
      ticker: "AMD",
      strike: 500,
      option_type: "PUT",
      expiry: "07/22/2026",
      premium: 2_000_000,
      event_at: "2026-07-20T15:50:00.000Z",
      alerted_at: "2026-07-20T15:50:00.000Z",
    },
    {
      ticker: "AMD",
      strike: 500,
      option_type: "PUT",
      expiry: "2026-07-22",
      premium: 600_000,
      event_at: "2026-07-20T15:58:00.000Z",
      alerted_at: "2026-07-20T15:58:00.000Z",
    },
  ];
  const hits = countMatchingContractHits(
    alerts,
    { ticker: "AMD", strike: 500, option_type: "PUT", expiry: "2026-07-22" },
    HELIX_STRIKE_HITS_WINDOW_MS,
    nowMs
  );
  assert.equal(hits, 2);
});

test("countMatchingContractHits does not count the neighbouring half-dollar strike", () => {
  // MEASURED on the live tape 2026-08-23: INTC 92.5P and INTC 93P both printed on 2026-08-21, and
  // the old Math.round(strike) comparison counted each toward the other's "N hits" line — the exact
  // number a member reads as repeat conviction on ONE contract.
  const nowMs = Date.parse("2026-08-21T16:00:00.000Z");
  const at = "2026-08-21T15:55:00.000Z";
  const row = (strike: number) => ({
    ticker: "INTC",
    strike,
    option_type: "PUT",
    expiry: "2026-08-21",
    premium: 500_000,
    event_at: at,
    alerted_at: at,
  });
  const alerts = [row(92.5), row(92.5), row(93)];
  assert.equal(
    countMatchingContractHits(alerts, row(93), HELIX_STRIKE_HITS_WINDOW_MS, nowMs),
    1
  );
  assert.equal(
    countMatchingContractHits(alerts, row(92.5), HELIX_STRIKE_HITS_WINDOW_MS, nowMs),
    2
  );
});

test("countMatchingContractHits refuses to count when the target strike is unusable", () => {
  // Number(null) is 0, so a strikeless target must be rejected rather than silently counting every
  // strike-0 row — or worse, every row whose strike also failed to parse.
  const nowMs = Date.parse("2026-08-21T16:00:00.000Z");
  const at = "2026-08-21T15:55:00.000Z";
  const mk = (strike: unknown) => ({
    ticker: "INTC",
    strike: strike as number,
    option_type: "PUT",
    expiry: "2026-08-21",
    premium: 500_000,
    event_at: at,
    alerted_at: at,
  });
  assert.equal(
    countMatchingContractHits([mk(null), mk(93)], mk(null), HELIX_STRIKE_HITS_WINDOW_MS, nowMs),
    0
  );
});

test("countMatchingContractHits ignores tape_time_estimated ingest fallback", () => {
  const nowMs = Date.parse("2026-07-20T16:00:00.000Z");
  const alerts = [
    {
      ticker: "AMD",
      strike: 180,
      option_type: "CALL",
      expiry: "2026-07-22",
      premium: 500_000,
      event_at: null,
      alerted_at: "2026-07-20T15:59:00.000Z",
      tape_time_estimated: true,
    },
  ];
  const hits = countMatchingContractHits(
    alerts,
    { ticker: "AMD", strike: 180, option_type: "CALL", expiry: "2026-07-22" },
    HELIX_STRIKE_HITS_WINDOW_MS,
    nowMs
  );
  assert.equal(hits, 0);
});
