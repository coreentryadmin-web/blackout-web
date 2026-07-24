import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeSwingPosition,
  gradeSwingScaleOut,
  graderTimeframeForSubLane,
  SWING_GRADE_VERSION,
  type SwingGradeInput,
} from "./grade.ts";
import { gradeBangerScaleOut, type BangerScaleOutGrade } from "../zerodte/banger-scale-out-grade.ts";
import type { ScaleOutBar } from "../zerodte/scale-out.ts";

// A minute-spaced forward bar series helper (t in epoch-ms).
function bar(t: number, o: number, h: number, l: number, c: number) {
  return { t, o, h, l, c };
}
function optBar(t: number, h: number, l: number, c: number): ScaleOutBar {
  return { t, h, l, c };
}

// ── graderTimeframeForSubLane (SEV-9 pin: minute/hour/day) ──────────────────────
test("graderTimeframeForSubLane pins TACTICAL→minute, STANDARD→hour, EXTENDED→day; null→day", () => {
  assert.equal(graderTimeframeForSubLane("TACTICAL"), "minute");
  assert.equal(graderTimeframeForSubLane("STANDARD"), "hour");
  assert.equal(graderTimeframeForSubLane("EXTENDED"), "day");
  assert.equal(graderTimeframeForSubLane(null), "day");
});

// ── EXECUTION truth ─────────────────────────────────────────────────────────────
test("execution: LONG paid UP is adverse (quality < 1); ungradeable until a real fill", () => {
  const worse = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", plannedEntryPx: 100, actualEntryPx: 101 });
  assert.equal(worse.execution.gradeable, true);
  assert.equal(worse.execution.adverseSlippagePct, 1); // paid 1% over plan
  assert.ok(worse.execution.quality01! < 1);

  const better = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", plannedEntryPx: 100, actualEntryPx: 99 });
  assert.equal(better.execution.adverseSlippagePct, -1); // filled 1% better
  assert.equal(better.execution.quality01, 1); // favorable slippage caps at 1

  const noFill = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", plannedEntryPx: 100, actualEntryPx: null });
  assert.equal(noFill.execution.gradeable, false);
  assert.equal(noFill.execution.reason, "no_fill"); // actualFill:null discipline — no imputed grade
});

test("execution: SHORT slippage sign is mirrored (filled LOWER is adverse)", () => {
  const g = gradeSwingPosition({ subLane: "TACTICAL", direction: "SHORT", plannedEntryPx: 100, actualEntryPx: 99 });
  assert.equal(g.execution.adverseSlippagePct, 1); // got a worse (lower) short basis
});

// ── PATH truth (MFE/MAE on the grader timeframe) ────────────────────────────────
test("path: LONG MFE/MAE vs entry; timeframe follows the sub-lane", () => {
  const bars = [bar(1, 100, 100, 100, 100), bar(2, 100, 110, 95, 108), bar(3, 108, 112, 104, 110)];
  const g = gradeSwingPosition({ subLane: "TACTICAL", direction: "LONG", actualEntryPx: 100, underlyingBars: bars });
  assert.equal(g.path.gradeable, true);
  assert.equal(g.path.graderTimeframe, "minute"); // TACTICAL
  assert.equal(g.path.mfePct, 12); // max high 112 → +12%
  assert.equal(g.path.maePct, -5); // min low 95 → −5%
  assert.equal(g.path.bars, 3);
});

test("path: SHORT flips favorable direction; truncated/empty bars → ungradeable", () => {
  const bars = [bar(1, 100, 100, 100, 100), bar(2, 100, 103, 90, 92)];
  const g = gradeSwingPosition({ subLane: "STANDARD", direction: "SHORT", actualEntryPx: 100, underlyingBars: bars });
  assert.equal(g.path.mfePct, 10); // min low 90 → +10% favorable for a SHORT
  assert.equal(g.path.maePct, -3); // max high 103 → −3% adverse

  const empty = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", actualEntryPx: 100, underlyingBars: [] });
  assert.equal(empty.path.gradeable, false);
  assert.equal(empty.path.reason, "no_forward_bars");
});

// ── THESIS truth (structural, underlying terms; stop-before-target intrabar) ─────
test("thesis: LONG confirms on target, invalidates on stop, OPEN when neither", () => {
  const up = [bar(1, 100, 101, 99, 100), bar(2, 100, 106, 100, 105)];
  const confirmed = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", targetUnderlyingPx: 105, thesisInvalidationPx: 95, underlyingBars: up });
  assert.equal(confirmed.thesis.outcome, "CONFIRMED");

  const down = [bar(1, 100, 101, 99, 100), bar(2, 100, 100, 94, 95)];
  const invalidated = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", targetUnderlyingPx: 110, thesisInvalidationPx: 95, underlyingBars: down });
  assert.equal(invalidated.thesis.outcome, "INVALIDATED");

  const flat = [bar(1, 100, 101, 99, 100), bar(2, 100, 102, 98, 100)];
  const open = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", targetUnderlyingPx: 110, thesisInvalidationPx: 90, underlyingBars: flat });
  assert.equal(open.thesis.outcome, "OPEN");
});

test("thesis: a bar straddling BOTH levels resolves to INVALIDATED (stop checked before target)", () => {
  // Single bar low 94 (< stop 95) AND high 111 (> target 110). Conservative ordering must pick the stop.
  const straddle = [bar(1, 100, 111, 94, 100)];
  const g = gradeSwingPosition({ subLane: "TACTICAL", direction: "LONG", targetUnderlyingPx: 110, thesisInvalidationPx: 95, underlyingBars: straddle });
  assert.equal(g.thesis.outcome, "INVALIDATED");
});

test("thesis: SHORT mirrors; no thesis levels → ungradeable", () => {
  const down = [bar(1, 100, 101, 99, 100), bar(2, 100, 100, 89, 90)];
  const confirmed = gradeSwingPosition({ subLane: "STANDARD", direction: "SHORT", targetUnderlyingPx: 90, thesisInvalidationPx: 106, underlyingBars: down });
  assert.equal(confirmed.thesis.outcome, "CONFIRMED");

  const g = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", underlyingBars: down });
  assert.equal(g.thesis.gradeable, false);
  assert.equal(g.thesis.reason, "no_thesis_levels");
});

// ── FINANCIAL truth (gradeBangerScaleOut parity + survivorship guard) ────────────
test("gradeSwingScaleOut is a verbatim parity wrapper over gradeBangerScaleOut", () => {
  const entry = 1.0;
  const bars = [optBar(1, 1.2, 0.9, 1.1), optBar(2, 2.2, 1.0, 2.0), optBar(3, 2.5, 1.1, 1.3)];
  const a = gradeSwingScaleOut(entry, bars, "2026-08-21");
  const b = gradeBangerScaleOut(entry, bars, "2026-08-21");
  assert.deepEqual(a, b);
});

test("financial: truncated forward series → ungradeable, NEVER imputed to a number (survivorship)", () => {
  // Last bar dated 2026-07-24 but expiry 2026-08-21 → forward_bars_truncated, per gradeBangerScaleOut.
  const t = Date.parse("2026-07-24T18:00:00Z");
  const bars = [optBar(t, 1.5, 0.9, 1.4)];
  const g = gradeSwingPosition({ subLane: "EXTENDED", direction: "LONG", entryPremium: 1.0, optionBars: bars, expiryYmd: "2026-08-21" });
  assert.equal(g.financial.ungradeable, true);
  assert.equal(g.financial.reason, "forward_bars_truncated");
  assert.equal(g.financial.scaleOutRealizedMult, null); // not a fabricated 0/1×
  assert.equal(g.financial.holdMult, null);
  // Management inherits the guard — it can only grade what financial could.
  assert.equal(g.management.gradeable, false);
});

test("financial: no entry premium → ungradeable with reason", () => {
  const g = gradeSwingPosition({ subLane: "STANDARD", direction: "LONG", entryPremium: null, optionBars: [] });
  assert.equal(g.financial.ungradeable, true);
  assert.equal(g.financial.reason, "no_entry_premium");
});

// ── MANAGEMENT truth (capture vs naive hold) ────────────────────────────────────
test("management: captures a fraction of the option MFE and reports edge vs hold", () => {
  // Entry 1.0; option runs to a 3× high (h=3.0) then fades. Grade to expiry so financial is gradeable.
  const t0 = Date.parse("2026-08-21T13:30:00Z");
  const bars = [optBar(t0, 1.4, 0.9, 1.3), optBar(t0 + 3600e3, 3.0, 1.2, 2.6), optBar(t0 + 7200e3, 2.4, 1.0, 1.2)];
  const g = gradeSwingPosition({ subLane: "TACTICAL", direction: "LONG", entryPremium: 1.0, optionBars: bars, expiryYmd: "2026-08-21" });
  assert.equal(g.management.gradeable, true);
  assert.equal(g.management.optionMfeMult, 3); // peak high 3.0 / entry 1.0
  assert.ok(g.management.scaleOutMult! > g.management.holdMult!); // managed beat naive hold-to-expiry
  assert.ok(g.management.captureRatio != null && g.management.captureRatio > 0);
  assert.equal(g.management.edgeVsHold, Math.round((g.management.scaleOutMult! - g.management.holdMult!) * 100) / 100);
});

// ── Independence + shape ────────────────────────────────────────────────────────
test("five truths are independent: option series thin but underlying truths still grade", () => {
  const under = [bar(1, 100, 100, 100, 100), bar(2, 100, 108, 96, 106)];
  const g = gradeSwingPosition({
    subLane: "STANDARD",
    direction: "LONG",
    actualEntryPx: 100,
    plannedEntryPx: 100,
    targetUnderlyingPx: 105,
    thesisInvalidationPx: 95,
    underlyingBars: under,
    // no option bars / entry premium at all
  });
  assert.equal(g.v, SWING_GRADE_VERSION);
  assert.equal(g.execution.gradeable, true);
  assert.equal(g.path.gradeable, true);
  assert.equal(g.thesis.gradeable, true);
  assert.equal(g.thesis.outcome, "CONFIRMED");
  assert.equal(g.financial.ungradeable, true); // no option evidence
  assert.equal(g.management.gradeable, false); // inherits the financial gap
});
