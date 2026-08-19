import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchMeridianEnrichmentExpectedMove } from "./meridian-earnings-event-load-core";
import type { MeridianEarningsEnrichment } from "@/features/meridian/lib/meridian-types";

const baseEnrichment = (): MeridianEarningsEnrichment => ({
  catalysts: [],
  earnings_headlines: [],
  street_estimates: null,
  earnings_calendar: null,
  earnings_yoy: null,
  corporate_guidance: null,
  guidance_entitled: true,
  post_print: null,
  print_history: [
    {
      report_date: "2026-05-01",
      surprise_pct: 2.1,
      beat: true,
      session_change_pct: 4.5,
      expected_move_pct: 5.0,
    },
  ],
  print_history_summary: null,
  calendar_error: null,
  beat_rates: null,
  analyst_revisions: [],
  price_targets: [],
  street_skew: null,
  estimate_revisions: [],
  catalyst_briefs: [],
  insider_activity: [],
  congress_trades: [],
  expected_vs_realized: null,
});

describe("patchMeridianEnrichmentExpectedMove", () => {
  test("patches expected_vs_realized when pack supplies chain IV move", () => {
    const out = patchMeridianEnrichmentExpectedMove(baseEnrichment(), 6.2);
    assert.ok(out.expected_vs_realized);
    assert.equal(out.expected_vs_realized?.expected_move_pct, 6.2);
    assert.equal(out.expected_vs_realized?.realized_move_pct, 4.5);
  });

  test("leaves enrichment unchanged when expected move is absent", () => {
    const input = baseEnrichment();
    const out = patchMeridianEnrichmentExpectedMove(input, null);
    assert.equal(out, input);
  });
});
