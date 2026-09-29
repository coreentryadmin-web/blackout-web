import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  detectBookPostureCorrected,
  compareBearishPosture,
  buildBearishPostureShadowSnapshotRow,
} from "./bearish-posture-shadow";
import { detectBookPosture } from "./bearish-posture";
import type { NightHawkRegimeContext, ScoredCandidate } from "./scorer";

function regime(overrides: Partial<NightHawkRegimeContext> = {}): NightHawkRegimeContext {
  return {
    vix_iv_rank: 50,
    tide_bias: "NEUTRAL",
    advance_pct: 50,
    composite_regime: null,
    anomaly_tickers: [],
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker: "AMD",
    score: 45,
    direction: "long",
    flow_score: 18,
    tech_score: 8,
    pos_score: 5,
    news_score: 0,
    smart_money_score: 6,
    conviction: "B",
    ...overrides,
  };
}

// derive-composite.ts's real 7-value enum — the only strings composite_regime can ever actually
// hold in production, per src/app/api/cron/market-regime-detector/derive-composite.ts.
const REAL_COMPOSITE_VALUES = [
  "MEAN_REVERT_TRENDING_UP",
  "MEAN_REVERT_TRENDING_DOWN",
  "AMPLIFY_BREAKOUT",
  "AMPLIFY_BREAKDOWN",
  "AMPLIFY_MIXED",
  "MEAN_REVERT_MIXED",
  "NEUTRAL",
] as const;
const REAL_BEARISH_VALUES = new Set(["MEAN_REVERT_TRENDING_DOWN", "AMPLIFY_BREAKDOWN"]);

describe("detectBookPostureCorrected", () => {
  for (const value of REAL_COMPOSITE_VALUES) {
    test(`single composite_regime=${value} alone → NEUTRAL (2-of-3 floor never reached by 1 signal)`, () => {
      // Both the real detectBookPosture and this corrected mirror return reasons:[] unconditionally
      // on the NEUTRAL branch (bearish-posture.ts's own `return { posture: "NEUTRAL", reasons: [] }`)
      // regardless of how many signals fired below threshold -- so reasons.length is always 0 here,
      // whether or not this specific value would have contributed. The real assertion worth making
      // is that NO single real value ever reaches SHORT alone.
      const r = detectBookPostureCorrected(regime({ composite_regime: value }));
      assert.equal(r.posture, "NEUTRAL");
      assert.equal(r.reasons.length, 0);
    });
  }

  test("bearish values (MEAN_REVERT_TRENDING_DOWN, AMPLIFY_BREAKDOWN) each contribute a real signal once paired with a second signal", () => {
    for (const value of REAL_BEARISH_VALUES) {
      const r = detectBookPostureCorrected(regime({ tide_bias: "BEARISH", composite_regime: value }));
      assert.equal(r.posture, "SHORT", `${value} should combine with tide to reach SHORT`);
      assert.equal(r.reasons.length, 2);
    }
  });

  test("non-bearish values never contribute a signal, even paired with a second real signal", () => {
    const nonBearish = REAL_COMPOSITE_VALUES.filter((v) => !REAL_BEARISH_VALUES.has(v));
    for (const value of nonBearish) {
      const r = detectBookPostureCorrected(regime({ tide_bias: "BEARISH", composite_regime: value }));
      assert.equal(r.posture, "NEUTRAL", `${value} + tide alone should stay under the 2-of-3 floor`);
    }
  });

  test("AMPLIFY_BREAKDOWN + breadth collapse → SHORT (corrected gate reaches 2-of-3, via a different pair than tide)", () => {
    const r = detectBookPostureCorrected(regime({ advance_pct: 25, composite_regime: "AMPLIFY_BREAKDOWN" }));
    assert.equal(r.posture, "SHORT");
    assert.equal(r.reasons.length, 2);
  });

  test("null regime → NEUTRAL", () => {
    assert.equal(detectBookPostureCorrected(null).posture, "NEUTRAL");
    assert.equal(detectBookPostureCorrected(undefined).posture, "NEUTRAL");
  });
});

describe("compareBearishPosture — no-drift guarantee", () => {
  test("actual side always deepEquals a direct detectBookPosture call, across every fixture", () => {
    const fixtures: NightHawkRegimeContext[] = [
      regime(),
      regime({ tide_bias: "BEARISH", advance_pct: 25 }),
      regime({ tide_bias: "BEARISH", composite_regime: "MEAN_REVERT_TRENDING_DOWN" }),
      regime({ advance_pct: 20, composite_regime: "AMPLIFY_BREAKDOWN" }),
      regime({ tide_bias: "BULLISH", advance_pct: 70 }),
    ];
    const candidates = [scored({ ticker: "AMD", direction: "long" }), scored({ ticker: "TSLA", score: 40, direction: "short" })];
    for (const r of fixtures) {
      const comparison = compareBearishPosture(candidates, r);
      assert.deepEqual(comparison.actual, detectBookPosture(r));
    }
  });

  test("an invalid (never-real) composite_regime string containing literal 'BEARISH' fires the buggy check but not the corrected one", () => {
    // "BEARISH" is not a real derive-composite.ts value (the 7 real values never contain that
    // substring) — but if it ever leaked in from somewhere else, this documents the asymmetry:
    // the OLD buggy .includes("BEARISH") check matches this string literally, while the CORRECTED
    // .includes("DOWN") check does not. This is a real divergence, the opposite of a no-op.
    const comparison = compareBearishPosture([scored()], regime({ tide_bias: "BEARISH", composite_regime: "BEARISH" }));
    assert.equal(comparison.actual.posture, "SHORT", "buggy check matches the literal substring 'BEARISH'");
    assert.equal(comparison.corrected.posture, "NEUTRAL", "corrected check requires 'DOWN', which 'BEARISH' lacks");
    assert.equal(comparison.would_differ, true);
  });

  test("real bug reproduced: MEAN_REVERT_TRENDING_DOWN + tide BEARISH — actual stays NEUTRAL, corrected reaches SHORT", () => {
    const candidates = [
      scored({ ticker: "AMD", score: 55, direction: "long", flow_score: 25 }),
      scored({ ticker: "TSLA", score: 42, direction: "short" }),
    ];
    const r = regime({ tide_bias: "BEARISH", composite_regime: "MEAN_REVERT_TRENDING_DOWN" });
    const comparison = compareBearishPosture(candidates, r);

    assert.equal(comparison.actual.posture, "NEUTRAL", "today's real (buggy) production behavior");
    assert.equal(comparison.corrected.posture, "SHORT", "the fix restores the intended 2-of-3 gate");
    assert.equal(comparison.would_differ, true);
    assert.notEqual(comparison.would_be_shorts_boosted, null);
    assert.ok(Array.isArray(comparison.would_be_top5_tickers));
  });

  test("when both sides agree, would_be_top5_tickers is null and top5_would_change is false", () => {
    const comparison = compareBearishPosture([scored()], regime());
    assert.equal(comparison.actual.posture, "NEUTRAL");
    assert.equal(comparison.corrected.posture, "NEUTRAL");
    assert.equal(comparison.would_differ, false);
    assert.equal(comparison.would_be_top5_tickers, null);
    assert.equal(comparison.top5_would_change, false);
  });
});

describe("buildBearishPostureShadowSnapshotRow", () => {
  test("one sentinel row, ticker=__EDITION__, stage=bearish_posture_shadow, no rank/score", () => {
    const comparison = compareBearishPosture([scored()], regime());
    const row = buildBearishPostureShadowSnapshotRow("2026-09-22", comparison);
    assert.equal(row.edition_for, "2026-09-22");
    assert.equal(row.ticker, "__EDITION__");
    assert.equal(row.stage, "bearish_posture_shadow");
    assert.equal(row.rank, null);
    assert.equal(row.score, null);
    assert.equal(row.selected_for_publish, null);
    assert.deepEqual(row.snapshot_json, comparison);
  });
});

describe("drift guard — production constants this module duplicates", () => {
  test("bearish-posture.ts still defines SHORT_POSTURE_BONUS=8 and LONG_POSTURE_PENALTY=6", () => {
    const src = readFileSync(fileURLToPath(new URL("./bearish-posture.ts", import.meta.url)), "utf8");
    assert.match(src, /const SHORT_POSTURE_BONUS = 8;/);
    assert.match(src, /const LONG_POSTURE_PENALTY = 6;/);
  });

  test("bearish-posture.ts's composite_regime check is STILL the buggy BEARISH/NEGATIVE string match", () => {
    // If this ever fails, bearish-posture.ts was changed (possibly the real fix landed) and this
    // whole shadow module's premise — and detectBookPostureCorrected's usefulness — needs revisiting.
    const src = readFileSync(fileURLToPath(new URL("./bearish-posture.ts", import.meta.url)), "utf8");
    assert.match(src, /comp\.includes\("BEARISH"\) \|\| comp\.includes\("NEGATIVE"\)/);
  });
});
