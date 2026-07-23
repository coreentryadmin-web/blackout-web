import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeBangerScaleOut, bangerOccSymbol } from "./banger-scale-out-grade";
import { gradeScaleOut, type ScaleOutBar } from "./scale-out";

const bar = (t: number, h: number, l: number, c: number): ScaleOutBar => ({ t, h, l, c });

// ── gradeBangerScaleOut ──────────────────────────────────────────────────────────
test("grades on the scale-out basis: 2× then rips to 5× → half banked at 2×, runner rides", () => {
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 5.0, 3.0, 5.0)];
  const g = gradeBangerScaleOut(1, bars);
  assert.equal(g.ungradeable, false);
  assert.equal(g.scale_out_realized_mult, 3.5); // 0.5*2 + 0.5*5 (matches scale-out.test)
  assert.equal(g.hold_mult, 5.0); // last close / entry
});

test("parity: the realized mult IS gradeScaleOut on the same bars (no drift from the production rule)", () => {
  const bars = [bar(1, 2.1, 1.0, 2.0), bar(2, 4.0, 3.0, 3.5), bar(3, 3.0, 1.9, 2.0)];
  const g = gradeBangerScaleOut(1, bars);
  assert.equal(g.scale_out_realized_mult, Math.round(gradeScaleOut(bars, 1) * 100) / 100);
});

test("hold underperforms scale-out on a spike-then-decay banger (the whole reason the exit exists)", () => {
  // spikes to 4× then bleeds back to ~1×: scale-out banks the spike, hold gives it all back.
  const bars = [bar(1, 4.0, 1.0, 3.0), bar(2, 3.2, 0.9, 1.0)];
  const g = gradeBangerScaleOut(1, bars);
  assert.ok(g.scale_out_realized_mult! > g.hold_mult!, "scale-out beats hold on a decayer");
  assert.equal(g.hold_mult, 1.0);
});

test("bad entry premium → ungradeable (never a fabricated multiple)", () => {
  for (const e of [null, 0, -1]) {
    const g = gradeBangerScaleOut(e, [bar(1, 2, 1, 1.5)]);
    assert.equal(g.ungradeable, true);
    assert.equal(g.scale_out_realized_mult, null);
  }
});

test("no usable forward bars → ungradeable (thin/expired OTM weekly — the survivorship guard)", () => {
  assert.equal(gradeBangerScaleOut(1, []).ungradeable, true);
  // all bars malformed (c<=0 / NaN) → filtered out → ungradeable, not a bogus grade
  const g = gradeBangerScaleOut(1, [bar(1, 0, 0, 0), { t: 2, h: NaN, l: 1, c: 1 } as ScaleOutBar]);
  assert.equal(g.ungradeable, true);
  assert.equal(g.reason, "no_forward_bars");
});

// ── bangerOccSymbol ──────────────────────────────────────────────────────────────
test("builds the OCC symbol from ticker/strike/expiry/side", () => {
  assert.equal(bangerOccSymbol("NVDA", 880, "2026-07-10", "call"), "O:NVDA260710C00880000");
  assert.equal(bangerOccSymbol("spy", 6.5, "2026-07-10", "put"), "O:SPY260710P00006500");
});

test("malformed inputs → null (caller records ungradeable, never fetches a garbage symbol)", () => {
  assert.equal(bangerOccSymbol("", 880, "2026-07-10", "call"), null);
  assert.equal(bangerOccSymbol("NVDA", 0, "2026-07-10", "call"), null);
  assert.equal(bangerOccSymbol("NVDA", 880, "07/10/2026", "call"), null);
});
