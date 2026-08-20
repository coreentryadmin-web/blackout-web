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

/**
 * FUNNEL TOTALS MUST NOT BE DERIVED FROM A CAPPED SAMPLE.
 *
 * `fetchZeroDteDiscoveryEvents` returns the newest `EVENTS_SAMPLE_LIMIT` (2000) rows and the funnel
 * counted kinds inside that window. MEASURED ON PROD 2026-08-20 mid-session the admin funnel
 * returned `detected 642 + gate_blocked 1354 + commit 4 = 2000` — exactly the cap, i.e. saturated.
 *
 * The damage is not evenly spread. `gate_blocked` runs to thousands a session while `commit` runs
 * to single digits, so commits are ~0.2% of the stream and whether any survive the window is luck
 * of the ordering. At one instant the BOARD said `commit_events: 0`, the ADMIN funnel said 4, and
 * the LEDGER held 7 committed rows — one quantity, three answers, and the most visible one said
 * nothing traded on a day that traded seven times.
 */

test("REGRESSION: a saturated sample does not decide the commit count", () => {
  // 2000 sampled events, every one gate_blocked — the shape a busy session actually produces once
  // the window saturates. The sample contains ZERO commits.
  const events = Array.from({ length: 2000 }, (_, i) => ({
    observed_at: `2026-08-20T15:0${i % 10}:00Z`,
    ticker: `T${i % 50}`,
    kind: "gate_blocked",
    gate_code: "score_floor",
    score: null,
    detail: null,
    payload: null,
  }));

  const sampledOnly = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events,
    rejections: [],
    events_sample_capped: true,
    rejections_sample_capped: false,
  });
  assert.equal(sampledOnly.commit_events, 0, "the sample genuinely contains no commits");

  // Same sample, plus the exact aggregate. The seven real commits must survive.
  const withExact = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events,
    rejections: [],
    events_sample_capped: true,
    rejections_sample_capped: false,
    exact_kind_counts: { gate_blocked: 5400, detected: 900, commit: 7 },
    exact_detected_tickers: 118,
  });
  assert.equal(withExact.commit_events, 7, "the exact count must win over the saturated sample");
  assert.equal(withExact.gate_blocked_events, 5400, "and it must win for the high-volume kind too");
  assert.equal(withExact.detected_tickers, 118, "distinct tickers likewise");
});

test("an exact ZERO is not overwritten by a sampled non-zero", () => {
  // `??`, not `||`. A real zero is a fact — "nothing committed today" is exactly the answer the
  // funnel exists to give on a halted session, and `||` would discard it for the sampled value.
  const events = [
    { observed_at: "2026-08-20T15:00:00Z", ticker: "SPY", kind: "commit", gate_code: "COMMIT", score: 70, detail: null, payload: null },
  ];
  const out = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events,
    rejections: [],
    events_sample_capped: false,
    rejections_sample_capped: false,
    exact_kind_counts: { commit: 0 },
    exact_detected_tickers: 0,
  });
  assert.equal(out.commit_events, 0, "exact zero must survive");
  assert.equal(out.detected_tickers, 0);
});

test("without exact counts the sampled behaviour is unchanged", () => {
  // The counts are optional so every existing caller keeps working. This pins that the fallback is
  // byte-identical to the old path rather than quietly changed.
  const events = [
    { observed_at: "2026-08-20T15:00:00Z", ticker: "SPY", kind: "commit", gate_code: "COMMIT", score: 70, detail: null, payload: null },
    { observed_at: "2026-08-20T15:01:00Z", ticker: "QQQ", kind: "detected", gate_code: null, score: 60, detail: null, payload: null },
    { observed_at: "2026-08-20T15:02:00Z", ticker: "IWM", kind: "gate_blocked", gate_code: "score_floor", score: 10, detail: null, payload: null },
  ];
  const out = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events,
    rejections: [],
    events_sample_capped: false,
    rejections_sample_capped: false,
  });
  assert.equal(out.commit_events, 1);
  assert.equal(out.gate_blocked_events, 1);
  assert.equal(out.detected_tickers, 1);
});
