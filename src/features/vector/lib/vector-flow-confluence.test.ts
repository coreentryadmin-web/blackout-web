import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyFlowConfluenceToCandles,
  chartFocusToneForFlow,
  displayBarTimeForFlowPrint,
  flowAlertTimeSec,
  flowConfluencePulseIntensity,
  resolveFlowPrintBarTime,
  toneFromFlowSide,
  FLOW_CONFLUENCE_PULSE_MS,
} from "./vector-flow-confluence";

describe("vector-flow-confluence", () => {
  test("flowAlertTimeSec: parses ISO alerted_at", () => {
    const sec = flowAlertTimeSec({ alerted_at: "2026-08-15T14:35:00.000Z" });
    assert.equal(sec, Math.floor(Date.parse("2026-08-15T14:35:00.000Z") / 1000));
  });

  test("displayBarTimeForFlowPrint: buckets to chart interval", () => {
    assert.equal(displayBarTimeForFlowPrint(1_752_000_125, 1), 1_752_000_120);
    assert.equal(displayBarTimeForFlowPrint(1_752_000_125, 5), 1_752_000_000);
  });

  test("resolveFlowPrintBarTime: prefers exact bucket then last bar at/before", () => {
    const bars = [{ time: 100 }, { time: 160 }, { time: 220 }];
    assert.equal(resolveFlowPrintBarTime(160, 1, bars), 160);
    assert.equal(resolveFlowPrintBarTime(190, 1, bars), 160);
  });

  test("flowConfluencePulseIntensity: alternates then ends", () => {
    const start = 1_000_000;
    assert.equal(flowConfluencePulseIntensity(start, start), 1);
    assert.equal(flowConfluencePulseIntensity(start, start + 250), 0.45);
    assert.equal(flowConfluencePulseIntensity(start, start + FLOW_CONFLUENCE_PULSE_MS), 0);
  });

  test("applyFlowConfluenceToCandles: styles matching bar only", () => {
    const bars = [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 160, open: 2, high: 3, low: 1.5, close: 2.5 },
    ];
    const now = 5_000_000;
    const out = applyFlowConfluenceToCandles(
      bars,
      [{ barTimeSec: 160, tone: "bull", startedAtMs: now }],
      now
    );
    assert.ok(out[1]!.borderColor?.includes("#") || out[1]!.borderColor?.startsWith("rgba"));
    assert.equal(out[0]!.borderColor, undefined);
  });

  // Regression: the chart-flash tone (price-line flash + candle pulse for a live HELIX print)
  // used to read `option_type` alone (`isCall ? "bull" : "bear"`), so a SOLD call -- bearish
  // everywhere else this print's direction is asserted -- flashed the chart lime/bullish.
  describe("chartFocusToneForFlow: aggressor-aware, not option-type-alone", () => {
    test("a bought call reads bull", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "CALL", ask_pct: 80 }), "bull");
    });
    test("a SOLD call reads bear, not bull off option type alone", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "CALL", ask_pct: 8 }), "bear");
    });
    test("a bought put reads bear", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "PUT", ask_pct: 80 }), "bear");
    });
    test("a SOLD put reads bull, not bear off option type alone", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "PUT", ask_pct: 8 }), "bull");
    });
    test("no ask_pct data reads sky (neutral), never a guessed bull/bear", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "CALL", ask_pct: null }), "sky");
    });
    test("a midpoint ask_pct (undetermined aggressor) reads sky", () => {
      assert.equal(chartFocusToneForFlow({ option_type: "CALL", ask_pct: 50 }), "sky");
    });
  });

  describe("toneFromFlowSide: aggressor-aware, delegates to flowDirection", () => {
    test("a SOLD call reads bear, not bull", () => {
      assert.equal(toneFromFlowSide({ option_type: "CALL", ask_pct: 8 }), "bear");
    });
    test("a SOLD put reads bull, not bear", () => {
      assert.equal(toneFromFlowSide({ option_type: "PUT", ask_pct: 8 }), "bull");
    });
    test("undetermined aggressor falls back to the option-type-only read (no third state exists)", () => {
      assert.equal(toneFromFlowSide({ option_type: "CALL", ask_pct: null }), "bull");
      assert.equal(toneFromFlowSide({ option_type: "PUT", ask_pct: null }), "bear");
    });
  });
});
