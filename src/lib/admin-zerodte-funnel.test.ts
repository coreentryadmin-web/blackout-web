import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateZeroDteFunnel } from "./admin-zerodte-funnel";

test("aggregateZeroDteFunnel: merges discovery gate_blocked + scan rejections by gate", () => {
  const out = aggregateZeroDteFunnel({
    session_date: "2026-08-03",
    events: [
      {
        observed_at: "2026-08-03T14:00:00Z",
        ticker: "NVDA",
        kind: "detected",
        gate_code: null,
        score: 72,
        detail: "COMMIT",
      },
      {
        observed_at: "2026-08-03T14:02:00Z",
        ticker: "AMD",
        kind: "gate_blocked",
        gate_code: "min_gross",
        score: null,
        detail: "below floor",
      },
      {
        observed_at: "2026-08-03T14:05:00Z",
        ticker: "META",
        kind: "commit",
        gate_code: "COMMIT",
        score: 80,
        detail: "DIRECTIONAL",
      },
    ],
    rejections: [{ gate_failed: "min_gross" }, { gate_failed: "score_floor" }],
    events_sample_capped: false,
    rejections_sample_capped: false,
  });

  assert.equal(out.detected_tickers, 1);
  assert.equal(out.commit_events, 1);
  assert.equal(out.gate_blocked_events, 1);
  assert.equal(out.rejection_rows, 2);
  const gross = out.by_gate.find((g) => g.gate === "min_gross");
  assert.ok(gross && gross.n >= 2);
  assert.equal(out.by_kind.find((k) => k.kind === "detected")?.n, 1);
});

// veto-flicker-rate probe (INTENTIONAL-DESIGN #2, docs/audit/FINDINGS.md 2026-08-05): the
// funnel snapshot's raw_events/raw_rejections are the uncapped-at-24 rows the flicker harness
// reconstructs a per-ticker veto series from — must be chronological (oldest first, the DB
// read is DESC) and must carry `direction` pulled out of the JSONB payload.
test("aggregateZeroDteFunnel: raw_events is chronological with direction pulled from payload", () => {
  const out = aggregateZeroDteFunnel({
    session_date: "2026-08-04",
    events: [
      // fetchZeroDteDiscoveryEvents reads ORDER BY observed_at DESC — newest first in.
      {
        observed_at: "2026-08-04T14:10:00Z",
        ticker: "NVDA",
        kind: "detected",
        gate_code: null,
        score: 70,
        detail: null,
        payload: { direction: "long" },
      },
      {
        observed_at: "2026-08-04T14:05:00Z",
        ticker: "NVDA",
        kind: "gate_blocked",
        gate_code: "cortex_veto:flow",
        score: null,
        detail: "veto",
        payload: { direction: "long" },
      },
    ],
    rejections: [],
    events_sample_capped: false,
    rejections_sample_capped: false,
  });

  assert.equal(out.raw_events.length, 2);
  // Reversed to chronological order — the veto (14:05) comes before the clear (14:10).
  assert.equal(out.raw_events[0]!.observed_at, "2026-08-04T14:05:00Z");
  assert.equal(out.raw_events[0]!.gate_code, "cortex_veto:flow");
  assert.equal(out.raw_events[0]!.direction, "long");
  assert.equal(out.raw_events[1]!.observed_at, "2026-08-04T14:10:00Z");
});

test("aggregateZeroDteFunnel: raw_rejections carries first_seen/last_seen chronologically", () => {
  const out = aggregateZeroDteFunnel({
    session_date: "2026-08-04",
    events: [],
    rejections: [
      {
        gate_failed: "cortex_veto_blind",
        observed_at: "2026-08-04T15:00:00Z",
        ticker: "AMD",
        direction: "short",
        first_seen: "2026-08-04T14:50:00Z",
        last_seen: "2026-08-04T15:00:00Z",
      },
      {
        gate_failed: "min_gross",
        observed_at: "2026-08-04T14:40:00Z",
        ticker: "TSLA",
        direction: "long",
        first_seen: "2026-08-04T14:38:00Z",
        last_seen: "2026-08-04T14:40:00Z",
      },
    ],
    events_sample_capped: false,
    rejections_sample_capped: false,
  });

  assert.equal(out.raw_rejections.length, 2);
  assert.equal(out.raw_rejections[0]!.ticker, "TSLA");
  assert.equal(out.raw_rejections[0]!.first_seen, "2026-08-04T14:38:00Z");
  assert.equal(out.raw_rejections[1]!.ticker, "AMD");
  assert.equal(out.raw_rejections[1]!.gate_failed, "cortex_veto_blind");
});
