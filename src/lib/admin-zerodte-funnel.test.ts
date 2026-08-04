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
