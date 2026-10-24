import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diagnoseDirectionRow, diagnoseDirectionFailures } from "./direction-failure-diagnosis";
import type { DebriefAggregateRow } from "./debrief-aggregate";

function row(overrides: Partial<DebriefAggregateRow> & { publish_context?: Record<string, unknown> | null; debrief?: Record<string, unknown> | null }): DebriefAggregateRow {
  return {
    edition_for: "2026-09-01",
    ticker: "TEST",
    direction: "LONG",
    conviction: "B",
    outcome: "stop",
    pulled: false,
    pulled_reason: null,
    grade_methodology: "v2_fillability",
    publish_context: null,
    entry_range_low: 100,
    entry_range_high: 102,
    target: 110,
    stop: 95,
    debrief: null,
    ...overrides,
  } as DebriefAggregateRow;
}

function debrief(tag: string) {
  return { debrief_version: 1, failure_mode: { tag } };
}

function pc(overrides: Partial<{ confluence: Record<string, unknown>; market: Record<string, unknown>; tier: Record<string, unknown>; gate_promoted: boolean; gates: Record<string, unknown> }>) {
  return {
    confluence: { total_score: 40, flow_score: 20, tech_score: 10, pos_score: 5, smart_money_score: 5, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] },
    market: { tide_bias: "NEUTRAL", composite_regime: "NEUTRAL" },
    tier: null,
    gate_promoted: false,
    gates: null,
    ...overrides,
  };
}

describe("diagnoseDirectionRow — tag classification", () => {
  test("wrong_direction debrief tag flags is_wrong_direction", () => {
    const r = diagnoseDirectionRow(row({ debrief: debrief("wrong_direction") }));
    assert.equal(r.is_wrong_direction, true);
    assert.equal(r.is_comparison_winner, false);
  });

  test("clean_win/lucky_win/pulled_correctly all flag is_comparison_winner", () => {
    for (const tag of ["clean_win", "lucky_win", "pulled_correctly"]) {
      const r = diagnoseDirectionRow(row({ debrief: debrief(tag) }));
      assert.equal(r.is_comparison_winner, true, tag);
      assert.equal(r.is_wrong_direction, false, tag);
    }
  });

  test("stopped_normal is neither wrong-direction nor a comparison winner", () => {
    const r = diagnoseDirectionRow(row({ debrief: debrief("stopped_normal") }));
    assert.equal(r.is_wrong_direction, false);
    assert.equal(r.is_comparison_winner, false);
  });

  test("no pinned debrief at all -> both flags false, causes still computed from confluence", () => {
    const r = diagnoseDirectionRow(row({ debrief: null, publish_context: pc({}) }));
    assert.equal(r.is_wrong_direction, false);
    assert.equal(r.is_comparison_winner, false);
  });
});

describe("diagnoseDirectionRow — regime_conflict", () => {
  test("LONG direction + BEARISH tide_bias -> regime_conflicts_with_direction true", () => {
    const r = diagnoseDirectionRow(
      row({ direction: "LONG", debrief: debrief("wrong_direction"), publish_context: pc({ market: { tide_bias: "BEARISH", composite_regime: "NEUTRAL" } }) })
    );
    assert.equal(r.evidence.regime_conflicts_with_direction, true);
    assert.ok(r.causes.includes("regime_conflict"));
  });

  test("SHORT direction + BULLISH tide_bias -> conflict", () => {
    const r = diagnoseDirectionRow(
      row({ direction: "SHORT", debrief: debrief("wrong_direction"), publish_context: pc({ market: { tide_bias: "BULLISH", composite_regime: "NEUTRAL" } }) })
    );
    assert.equal(r.evidence.regime_conflicts_with_direction, true);
  });

  test("LONG + composite_regime containing DOWN -> conflict (the CORRECTED #30 gate, not the live dead one)", () => {
    const r = diagnoseDirectionRow(
      row({ direction: "LONG", debrief: debrief("wrong_direction"), publish_context: pc({ market: { tide_bias: "NEUTRAL", composite_regime: "MEAN_REVERT_TRENDING_DOWN" } }) })
    );
    assert.equal(r.evidence.regime_conflicts_with_direction, true);
  });

  test("aligned regime (LONG + BULLISH tide) -> no conflict", () => {
    const r = diagnoseDirectionRow(
      row({ direction: "LONG", debrief: debrief("clean_win"), publish_context: pc({ market: { tide_bias: "BULLISH", composite_regime: "NEUTRAL" } }) })
    );
    assert.equal(r.evidence.regime_conflicts_with_direction, false);
    assert.ok(!r.causes.includes("regime_conflict"));
  });
});

describe("diagnoseDirectionRow — flow-dominant weak structure", () => {
  test("flow carries most of the score while tech_score is weak -> flags both causes", () => {
    const r = diagnoseDirectionRow(
      row({
        debrief: debrief("wrong_direction"),
        publish_context: pc({ confluence: { total_score: 30, flow_score: 25, tech_score: 1, pos_score: 2, smart_money_score: 2, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }),
      })
    );
    assert.ok(r.causes.includes("flow_dominant_weak_structure"));
    assert.ok(r.causes.includes("structure_vs_flow_disagreement"));
    assert.equal(r.evidence.flow_dominance_pct, 83.3);
  });

  test("balanced flow/tech contribution -> no flow-dominance flag", () => {
    const r = diagnoseDirectionRow(
      row({
        debrief: debrief("wrong_direction"),
        publish_context: pc({ confluence: { total_score: 40, flow_score: 15, tech_score: 15, pos_score: 5, smart_money_score: 5, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }),
      })
    );
    assert.ok(!r.causes.includes("flow_dominant_weak_structure"));
  });
});

describe("diagnoseDirectionRow — catalyst/fundamental/gate-promoted/target-ATR causes", () => {
  test("earnings_risk true -> catalyst_or_fundamental_conflict", () => {
    const r = diagnoseDirectionRow(
      row({ debrief: debrief("wrong_direction"), publish_context: pc({ confluence: { total_score: 40, flow_score: 20, tech_score: 10, pos_score: 5, smart_money_score: 5, earnings_risk: true, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }) })
    );
    assert.ok(r.causes.includes("catalyst_or_fundamental_conflict"));
    assert.equal(r.evidence.earnings_risk, true);
  });

  test("gate_promoted true -> gate_promoted_marginal cause + evidence flag", () => {
    const context = { ...pc({}), gate_promoted: true };
    const r = diagnoseDirectionRow(row({ debrief: debrief("wrong_direction"), publish_context: context }));
    assert.ok(r.causes.includes("gate_promoted_marginal"));
    assert.equal(r.evidence.gate_promoted, true);
  });

  test("target ATR multiple over the live gate threshold -> overreaching_target", () => {
    const context = {
      ...pc({}),
      gates: { checks: [{ code: "target_unreachable", value: 3.5 }] },
    };
    const r = diagnoseDirectionRow(row({ debrief: debrief("wrong_direction"), publish_context: context }));
    assert.ok(r.causes.includes("overreaching_target"));
    assert.equal(r.evidence.target_atr_multiple, 3.5);
    assert.equal(r.evidence.over_target_atr_gate, true);
  });

  test("thin total score -> thin_confluence", () => {
    const r = diagnoseDirectionRow(
      row({ debrief: debrief("wrong_direction"), publish_context: pc({ confluence: { total_score: 10, flow_score: 5, tech_score: 3, pos_score: 1, smart_money_score: 1, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }) })
    );
    assert.ok(r.causes.includes("thin_confluence"));
  });

  test("no causes fire -> unclassified, never an empty list", () => {
    const r = diagnoseDirectionRow(row({ debrief: debrief("wrong_direction"), publish_context: pc({}) }));
    assert.deepEqual(r.causes, ["unclassified"]);
  });
});

describe("diagnoseDirectionRow — missing/malformed publish_context never throws, degrades to null", () => {
  test("publish_context null -> every evidence field null/false, causes still computed honestly", () => {
    const r = diagnoseDirectionRow(row({ debrief: debrief("wrong_direction"), publish_context: null }));
    assert.equal(r.evidence.total_score, null);
    assert.equal(r.evidence.flow_score, null);
    assert.equal(r.evidence.tide_bias, null);
    assert.equal(r.evidence.regime_conflicts_with_direction, false);
    assert.deepEqual(r.causes, ["unclassified"]);
  });

  test("malformed publish_context (array, string) never throws", () => {
    assert.doesNotThrow(() => diagnoseDirectionRow(row({ publish_context: [] as unknown as Record<string, unknown> })));
    assert.doesNotThrow(() => diagnoseDirectionRow(row({ publish_context: "garbage" as unknown as Record<string, unknown> })));
  });
});

describe("diagnoseDirectionFailures — aggregate report", () => {
  test("splits wrong-direction vs winner cohorts, builds a sorted cause breakdown, computes cohort means", () => {
    const rows: DebriefAggregateRow[] = [
      row({
        ticker: "A",
        direction: "LONG",
        debrief: debrief("wrong_direction"),
        publish_context: pc({ market: { tide_bias: "BEARISH", composite_regime: "NEUTRAL" }, confluence: { total_score: 30, flow_score: 20, tech_score: 2, pos_score: 4, smart_money_score: 4, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }),
      }),
      row({
        ticker: "B",
        direction: "SHORT",
        debrief: debrief("wrong_direction"),
        publish_context: pc({ market: { tide_bias: "BULLISH", composite_regime: "NEUTRAL" }, confluence: { total_score: 45, flow_score: 15, tech_score: 15, pos_score: 8, smart_money_score: 7, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }),
      }),
      row({
        ticker: "C",
        direction: "LONG",
        debrief: debrief("clean_win"),
        publish_context: pc({ market: { tide_bias: "BULLISH", composite_regime: "NEUTRAL" }, confluence: { total_score: 55, flow_score: 20, tech_score: 20, pos_score: 8, smart_money_score: 7, earnings_risk: false, catalyst_flags: [], fundamental_block: false, fundamental_flags: [] } }),
      }),
      row({ ticker: "D", direction: "LONG", debrief: debrief("stopped_normal"), publish_context: pc({}) }),
    ];
    const report = diagnoseDirectionFailures(rows, 90);
    assert.equal(report.wrong_direction_n, 2);
    assert.equal(report.comparison_winner_n, 1);
    assert.equal(report.rows.length, 3); // 2 wrong-direction + 1 winner; stopped_normal excluded
    assert.ok(report.cause_breakdown.length > 0);
    // regime_conflict fires for BOTH wrong-direction rows (A: LONG+BEARISH, B: SHORT+BULLISH)
    const regimeCause = report.cause_breakdown.find((c) => c.cause === "regime_conflict");
    assert.ok(regimeCause);
    assert.equal(regimeCause!.n, 2);
    assert.equal(regimeCause!.pct_of_wrong_direction, 100);
    assert.equal(report.wrong_direction_cohort.n, 2);
    assert.equal(report.winner_cohort.n, 1);
    assert.equal(report.wrong_direction_cohort.regime_conflict_rate_pct, 100);
    assert.equal(report.winner_cohort.regime_conflict_rate_pct, 0);
  });

  test("empty input -> zeroed report, never throws", () => {
    const report = diagnoseDirectionFailures([], 30);
    assert.equal(report.wrong_direction_n, 0);
    assert.equal(report.comparison_winner_n, 0);
    assert.deepEqual(report.cause_breakdown, []);
    assert.equal(report.wrong_direction_cohort.mean_total_score, null);
  });

  test("low_n flags when either cohort is under the floor", () => {
    const rows: DebriefAggregateRow[] = [row({ debrief: debrief("wrong_direction"), publish_context: pc({}) })];
    const report = diagnoseDirectionFailures(rows, 30);
    assert.equal(report.low_n, true);
  });
});
