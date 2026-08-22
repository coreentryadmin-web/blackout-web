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
  test("the PRINT'S OWN captured implied wins over the pack's live chain IV move", () => {
    // BEHAVIOUR CHANGE, deliberate. This used to assert 6.2 — the pack's live quote. But the
    // realized side is the 2026-05-01 print's +4.5% reaction, and the fixture carries that
    // print's own implied (5.0). Comparing a past reaction against today's chain IV is what
    // produced "Realized +2.6% vs ~0.2% implied (13×)" for BJ on prod 2026-08-21.
    const out = patchMeridianEnrichmentExpectedMove(baseEnrichment(), 6.2);
    assert.ok(out.expected_vs_realized);
    assert.equal(out.expected_vs_realized?.expected_move_pct, 5.0);
    assert.equal(out.expected_vs_realized?.realized_move_pct, 4.5);
    assert.equal(out.expected_vs_realized?.ratio, 0.9, "5.0 vs 4.5 — a real, like-for-like ratio");
  });

  test("with no captured implied for that print, the reaction is published without a verdict", () => {
    const base = baseEnrichment();
    base.print_history = [{ ...base.print_history[0]!, expected_move_pct: null }];
    const out = patchMeridianEnrichmentExpectedMove(base, 6.2);
    assert.equal(out.expected_vs_realized?.ratio, null);
    assert.equal(out.expected_vs_realized?.verdict, "unknown");
    assert.equal(out.expected_vs_realized?.realized_move_pct, 4.5);
  });

  test("leaves enrichment unchanged when expected move is absent", () => {
    const input = baseEnrichment();
    const out = patchMeridianEnrichmentExpectedMove(input, null);
    assert.equal(out, input);
  });
});
