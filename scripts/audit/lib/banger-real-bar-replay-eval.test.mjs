import { test } from "node:test";
import assert from "node:assert/strict";
import { replayScaleOut, replayPair } from "./banger-real-bar-replay-eval.mjs";

const bar = (t, h, l, c) => ({ t, h, l, c });
const CONTROL = { scale_at_mult: 2.0, scale_fraction: 0.5, trail_from_peak: 0.5 };
const CANDIDATE = { scale_at_mult: 2.0, scale_fraction: 0.33, trail_from_peak: 0.7 };

// ── Parity with production's OWN test fixtures (scale-out.test.ts) at default params ──
// These are not new assertions -- they are the exact same scenarios production's real
// gradeScaleOut is tested against, re-run here to prove this parametric clone matches it
// byte-for-byte at the default rule set before trusting it for anything else.

test("PARITY: hard stop before any 2x -> realized ~0.4x (-60%)", () => {
  const bars = [bar(1, 1.1, 0.35, 0.4), bar(2, 0.5, 0.2, 0.3)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 0.4);
  assert.equal(out.exitCause, "hard_stop");
});

test("PARITY: touches 2x then rips to 5x and holds -> half locked at 2x, runner rides to close", () => {
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 5.0, 3.0, 5.0)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 3.5);
  assert.equal(out.exitCause, "series_end_after_scale");
});

test("PARITY: touches 2x, peaks at 4x, then retraces below 50% of peak -> runner exits at 2x", () => {
  const bars = [bar(1, 2.1, 1.0, 2.0), bar(2, 4.0, 3.0, 3.5), bar(3, 3.0, 1.9, 2.0)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 2.0);
  assert.equal(out.exitCause, "trail_stop");
});

test("PARITY: never triggers -> holds to last close", () => {
  const bars = [bar(1, 1.5, 0.8, 1.2), bar(2, 1.6, 1.0, 1.3)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 1.3);
  assert.equal(out.exitCause, "series_end_never_triggered");
});

test("PARITY: conservative intrabar ordering -- a bar touching BOTH hard stop and 2x counts the stop", () => {
  const bars = [bar(1, 2.5, 0.3, 1.0)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 0.4);
});

test("PARITY: no bars / bad entry -> breakeven 1.0", () => {
  assert.equal(replayScaleOut([], 1, CONTROL).realizedMultiple, 1);
  assert.equal(replayScaleOut([bar(1, 2, 1, 1.5)], 0, CONTROL).realizedMultiple, 1);
});

test("PARITY: trailing stop cannot exit on a peak set by the SAME bar (no intrabar look-ahead)", () => {
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 10.0, 1.0, 3.0)];
  const out = replayScaleOut(bars, 1, CONTROL);
  assert.equal(round(out.realizedMultiple), 1.55);
});

function round(x) {
  return Math.round(x * 100) / 100;
}

// ── The specific adversarial scenario this whole module exists to catch: a MULTI-PEAK path ──

test("ADVERSARIAL: a tighter trail (70%) exits at an EARLIER, LOWER peak than the final one production's looser trail rides to", () => {
  // entry 1. Scale at bar1 (high 2.2 >= 2.0). Bar2 peaks at 3.0, then bar3 retraces to 2.0 -- that
  // IS <= 70% of peak(3.0)=2.1? No: 2.0 <= 2.1 is true -> the 70% trail fires HERE, at peak=3.0.
  // Bar4 then makes a MUCH higher new peak (8.0) that a real 70%-trail position could never have
  // seen, because it already exited at bar3. Production's real 50% trail does NOT fire at bar3
  // (2.0 is not <= 50%*3.0=1.5), so it rides on to see the bar4 peak of 8.0, then bar5 retraces to
  // 3.5 (<=0.5*8=4.0) and THAT is where production's real trail finally fires.
  const bars = [
    bar(1, 2.2, 1.0, 2.0), // scale bar
    bar(2, 3.0, 2.5, 2.8), // new peak 3.0
    bar(3, 2.9, 2.0, 2.1), // retrace to 2.0 -- fires the 70% trail (2.0 <= 0.7*3.0=2.1); does NOT fire 50% (2.0 > 1.5)
    bar(4, 8.0, 7.0, 7.5), // a peak the 70%-trail position never sees
    bar(5, 7.0, 3.5, 4.0), // retrace to 3.5 <= 0.5*8=4.0 -- fires the REAL 50% trail here
  ];
  const control = replayScaleOut(bars, 1, CONTROL); // production's real rule
  const candidate = replayScaleOut(bars, 1, CANDIDATE); // the tested 70%-trail rule

  assert.equal(candidate.exitCause, "trail_stop");
  assert.equal(candidate.peakAtExit, 3.0); // exited off the EARLY peak, never saw 8.0
  assert.equal(candidate.exitDayIndex, 2); // exited at bar3, index 2

  assert.equal(control.exitCause, "trail_stop");
  assert.equal(control.peakAtExit, 8.0); // production's real row DOES see the later, higher peak
  assert.equal(control.exitDayIndex, 4);

  // The critical proof: candidate's exit peak (3.0) is LOWER than control's (8.0) -- this is
  // EXACTLY the scenario the summary-tier reconstruction cannot distinguish from "the tighter
  // trail also gets to use the final global peak" (which would be wrong). A real-bar replay
  // correctly gives the tighter trail its OWN, earlier, lower peak.
  assert.ok(candidate.peakAtExit < control.peakAtExit);
});

test("SLIPPAGE: a positive slippagePctOfPremium fills every exit worse (lower realized) than zero slippage, identically applied to both legs", () => {
  // Same rip-and-hold scenario as the parity test above: scale at 2x, runner rides to close at 5x.
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 5.0, 3.0, 5.0)];
  const clean = replayScaleOut(bars, 1, CONTROL);
  const slipped = replayScaleOut(bars, 1, { ...CONTROL, slippagePctOfPremium: 0.03 });
  assert.equal(clean.exitCause, slipped.exitCause); // slippage never changes WHICH rule fires, only the fill price
  assert.ok(slipped.realizedMultiple < clean.realizedMultiple);
  // Exactly 3% worse on BOTH the scale fill (at 2x) and the final mark-to-close fill (at 5x):
  // clean = 0.5*2 + 0.5*5 = 3.5; slipped = 0.5*2*0.97 + 0.5*5*0.97 = 3.5*0.97 = 3.395 (floating-point
  // rounds to 3.39, not 3.40 -- confirmed, not a bug: 3.5*0.97 = 3.3949999999999996 in IEEE754).
  assert.equal(round(slipped.realizedMultiple), 3.39);
});

test("SLIPPAGE: a hard-stop fill is also degraded by the same fraction", () => {
  const bars = [bar(1, 1.1, 0.35, 0.4)];
  const clean = replayScaleOut(bars, 1, CONTROL);
  const slipped = replayScaleOut(bars, 1, { ...CONTROL, slippagePctOfPremium: 0.05 });
  assert.equal(clean.exitCause, "hard_stop");
  assert.equal(slipped.exitCause, "hard_stop");
  assert.equal(round(slipped.realizedMultiple), round(clean.realizedMultiple * 0.95));
});

test("replayPair: pairs control and candidate against the SAME bars and computes the delta", () => {
  const bars = [bar(1, 2.2, 1.0, 2.0), bar(2, 5.0, 3.0, 5.0)];
  const pair = replayPair(bars, 1, CONTROL, CANDIDATE);
  assert.ok(pair.control.realizedPnlPct != null);
  assert.ok(pair.candidate.realizedPnlPct != null);
  assert.equal(pair.delta, round2(pair.candidate.realizedPnlPct - pair.control.realizedPnlPct));
  function round2(x) {
    return Math.round(x * 100) / 100;
  }
});
