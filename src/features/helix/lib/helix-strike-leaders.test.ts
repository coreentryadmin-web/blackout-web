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
