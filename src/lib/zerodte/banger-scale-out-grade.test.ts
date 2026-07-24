import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradeBangerScaleOut,
  bangerOccSymbol,
  resolveBangerGradeRequest,
  optionAggBarsToScaleOut,
} from "./banger-scale-out-grade";
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

// ── expiry gate: hold_mult is hold-to-EXPIRY, not hold-to-last-bar ────────────────
const ms = (iso: string) => Date.parse(iso);

test("forward series truncated before expiry → ungradeable (never credits a non-expiry close as held-to-expiry)", () => {
  // Last bar is 2026-07-08 but the contract expires 2026-07-10: the option stopped
  // printing (thin) / Polygon paged short. hold_mult off the last bar (5×) would read an
  // artificially HIGH "still worth 5× at expiry" — the exact fabricated-value bug. Guard it.
  const bars = [bar(ms("2026-07-06T15:00:00Z"), 2.2, 1.0, 2.0), bar(ms("2026-07-08T15:00:00Z"), 5.0, 3.0, 5.0)];
  const g = gradeBangerScaleOut(1, bars, "2026-07-10");
  assert.equal(g.ungradeable, true);
  assert.equal(g.reason, "forward_bars_truncated");
  assert.equal(g.hold_mult, null);
  assert.equal(g.scale_out_realized_mult, null);
});

test("forward series reaches the expiry session → graded normally (expiry gate passes)", () => {
  const bars = [bar(ms("2026-07-08T15:00:00Z"), 2.2, 1.0, 2.0), bar(ms("2026-07-10T15:00:00Z"), 5.0, 3.0, 5.0)];
  const g = gradeBangerScaleOut(1, bars, "2026-07-10");
  assert.equal(g.ungradeable, false);
  assert.equal(g.hold_mult, 5.0);
});

test("no expiry supplied → gate is skipped (backward compatible)", () => {
  const bars = [bar(ms("2026-07-08T15:00:00Z"), 2.2, 1.0, 2.0)];
  assert.equal(gradeBangerScaleOut(1, bars).ungradeable, false);
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

// ── resolveBangerGradeRequest ─────────────────────────────────────────────────────
test("non-banger (no scale_out marker) → not_banger, whatever else is present", () => {
  const r = resolveBangerGradeRequest({
    ticker: "NVDA",
    exit_style: undefined,
    entry_premium: 1.2,
    contract: { strike: 880, side: "call", expiryYmd: "2026-07-10" },
  });
  assert.equal(r.kind, "not_banger");
  // a non-"scale_out" string is still not a banger
  assert.equal(resolveBangerGradeRequest({ ticker: "X", exit_style: "let_run", entry_premium: 1, contract: null }).kind, "not_banger");
});

test("banger, valid contract → ok with the OCC + entry premium + expiry the caller fetches against", () => {
  const r = resolveBangerGradeRequest({
    ticker: "nvda",
    exit_style: "scale_out",
    entry_premium: 1.25,
    contract: { strike: 880, side: "call", expiryYmd: "2026-07-10" },
  });
  assert.equal(r.kind, "ok");
  assert.deepEqual(r.kind === "ok" ? r.request : null, {
    occ: "O:NVDA260710C00880000",
    entryPremium: 1.25,
    expiryYmd: "2026-07-10",
    ticker: "NVDA",
    side: "call",
    strike: 880,
  });
});

test("banger but unresolvable → ungradeable with the reason, never a fetch of a garbage symbol", () => {
  const base = { ticker: "NVDA", exit_style: "scale_out" as const };
  // missing/zero entry premium
  for (const ep of [null, undefined, 0, -1]) {
    const r = resolveBangerGradeRequest({ ...base, entry_premium: ep, contract: { strike: 880, side: "call", expiryYmd: "2026-07-10" } });
    assert.equal(r.kind, "ungradeable");
    assert.equal(r.kind === "ungradeable" ? r.reason : "", "no_entry_premium");
  }
  // unparseable contract
  assert.equal(
    (resolveBangerGradeRequest({ ...base, entry_premium: 1, contract: null }) as { reason: string }).reason,
    "unparseable_contract"
  );
  // parsed but no side / no expiry (the nighthawk parser can return those as null)
  assert.equal(
    (resolveBangerGradeRequest({ ...base, entry_premium: 1, contract: { strike: 880, side: null, expiryYmd: "2026-07-10" } }) as { reason: string }).reason,
    "no_side"
  );
  assert.equal(
    (resolveBangerGradeRequest({ ...base, entry_premium: 1, contract: { strike: 880, side: "call", expiryYmd: null } }) as { reason: string }).reason,
    "no_expiry"
  );
});

// ── optionAggBarsToScaleOut ───────────────────────────────────────────────────────
test("maps Polygon AggBars → ScaleOutBars, dropping any bar without a finite timestamp", () => {
  const out = optionAggBarsToScaleOut([
    { t: 1, h: 2, l: 1, c: 1.5 },
    { t: undefined, h: 3, l: 1, c: 2 }, // AggBar.t is optional → dropped
    { t: NaN, h: 3, l: 1, c: 2 }, // non-finite → dropped
    { t: 2, h: 4, l: 2, c: 3 },
  ]);
  assert.deepEqual(out, [
    { t: 1, h: 2, l: 1, c: 1.5 },
    { t: 2, h: 4, l: 2, c: 3 },
  ]);
});
