import test from "node:test";
import assert from "node:assert/strict";
import { replayRatchetExit, replayPartialProfitRunner, type ExitBar } from "./early-entry-exit-variants.ts";

const T0 = Date.parse("2026-10-27T14:30:00Z");
const TIME_STOP = Date.parse("2026-10-27T19:50:00Z");
function bar(minFromEntry: number, h: number, l: number, c: number): ExitBar {
  return { t: T0 + minFromEntry * 60_000, h, l, c };
}

test("replayRatchetExit: hard stop fires on a bar whose low breaches -50% regardless of peak", () => {
  const bars = [bar(1, 2.1, 2.0, 2.0), bar(2, 2.0, 1.0, 1.0)]; // entry 2.0 -> -50% = 1.0
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.exitReason, "stopped");
  assert.equal(r.exitPx, 1.0);
});

test("replayRatchetExit: floor arms at +5% peak, locks at 40% of peak, breaches on a later pullback", () => {
  // entry 2.0 -> peak 4.0 is +100% -> floor = 100*0.4=40% -> floor px = 2.0*1.4=2.8
  const bars = [bar(1, 4.0, 3.9, 4.0), bar(2, 4.0, 2.5, 2.7)];
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.exitReason, "ratchet_floor");
  assert.equal(r.exitPx, 2.8);
  assert.equal(r.peakPx, 4.0);
});

test("replayRatchetExit: floor breach uses the PRIOR bar's armed floor, not the same bar's new peak", () => {
  // Bar 1 peaks at 4.0 (floor would arm at 2.8) but bar 1's own low (3.9) never breaches
  // a floor that didn't exist yet entering bar 1 (prior floor is null, peak was still 2.0).
  // Bar 2's low (2.5) breaches the floor ARMED FROM BAR 1'S peak (2.8).
  const bars = [bar(1, 4.0, 2.5, 3.9), bar(2, 4.0, 2.5, 2.7)];
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  // Bar 1: prior floor null -> no breach check fires; peak updates to 4.0 -> floor arms to 2.8.
  // Bar 2: low 2.5 <= armed floor 2.8 -> breaches on bar 2, not bar 1.
  assert.equal(r.exitReason, "ratchet_floor");
  assert.equal(r.exitAtMs, bars[1].t);
});

test("replayRatchetExit: flat_theta_bleed fires after 25min when peak/trough never left the +-10% band", () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(i + 1, 2.05, 1.98, 2.0));
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.exitReason, "flat_theta_bleed");
});

test("replayRatchetExit: holds to time_stop when nothing else fires", () => {
  const bars = [bar(1, 2.1, 2.0, 2.05)];
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.exitReason, "time_stop");
  assert.equal(r.exitPx, 2.05);
});

test("replayRatchetExit: hit10/hit20 are upper-bound peak-touch, independent of the exit rule's own fate", () => {
  // Price touches 11 then collapses back to a ratchet-floor exit well below 10.
  const bars = [bar(1, 11, 10.9, 11), bar(2, 11, 1.0, 1.0)];
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.hit10, true);
  assert.equal(r.hit20, false);
  assert.ok(r.timeToHit10Ms != null);
  // The hard stop fires before the ratchet floor would even be checked (same bar as the drop).
  assert.equal(r.exitCleared10, false);
});

test("replayRatchetExit: never reaching 10 leaves hit10/timeToHit10Ms honestly null/false", () => {
  const bars = [bar(1, 3.0, 2.8, 2.9)];
  const r = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  assert.equal(r.hit10, false);
  assert.equal(r.timeToHit10Ms, null);
});

test("replayPartialProfitRunner: banks 1/3 at $5, 1/3 at $10, runner continues unguarded to time_stop", () => {
  const bars = [bar(1, 5.0, 2.0, 5.0), bar(2, 10.0, 9.0, 10.0), bar(3, 15.0, 14.0, 15.0)];
  const r = replayPartialProfitRunner(2.0, bars, T0, TIME_STOP);
  assert.equal(r.tranchesBanked, 2);
  // blended = 1/3*5 + 1/3*10 + 1/3*15 = 5 + 3.333 + 5 = 10
  assert.ok(Math.abs(r.blendedExitPx - 10) < 0.02);
  assert.equal(r.exitReason, "tranche_then_time_stop");
});

test("replayPartialProfitRunner: hard stop before ANY tranche takes the whole position at the stop", () => {
  const bars = [bar(1, 2.1, 1.0, 1.0)]; // never reached $5, dropped straight to -50%
  const r = replayPartialProfitRunner(2.0, bars, T0, TIME_STOP);
  assert.equal(r.tranchesBanked, 0);
  assert.equal(r.exitReason, "stopped");
  assert.equal(r.blendedExitPx, 1.0);
});

test("replayPartialProfitRunner: stop AFTER the first tranche only affects the un-banked remainder", () => {
  // Banks 1/3 at $5, then the runner collapses to the -50% stop (entry*0.5 = 1.0).
  const bars = [bar(1, 5.0, 4.0, 5.0), bar(2, 5.0, 1.0, 1.0)];
  const r = replayPartialProfitRunner(2.0, bars, T0, TIME_STOP);
  assert.equal(r.tranchesBanked, 1);
  // blended = 1/3*5 + 2/3*1.0 = 1.6667 + 0.6667 = 2.333
  assert.ok(Math.abs(r.blendedExitPx - 2.333) < 0.02);
});

test("replayPartialProfitRunner: flat_theta_bleed only applies before any tranche arms", () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(i + 1, 2.05, 1.98, 2.0));
  const r = replayPartialProfitRunner(2.0, bars, T0, TIME_STOP);
  assert.equal(r.exitReason, "flat_theta_bleed");
  assert.equal(r.tranchesBanked, 0);
});

test("replayPartialProfitRunner: hit10/hit20 track the real underlying path exactly like the ratchet replay", () => {
  const bars = [bar(1, 21, 20, 21)];
  const r = replayPartialProfitRunner(2.0, bars, T0, TIME_STOP);
  assert.equal(r.hit10, true);
  assert.equal(r.hit20, true);
});

test("a WIDE_RUNNER config (arm later, looser lock) lets a big run go further before floor breach than the shipped defaults", () => {
  // Same bar path: peak 12.0 then pulls back to 6.0. Shipped (arm@5/frac0.4): floor at
  // peak-pnl 500% * 0.4 = 200% -> floor px = 2*(1+2) = 6.0 -- breaches exactly at 6.0.
  // Wide runner (arm@100/frac0.25): floor at 500%*0.25=125% -> floor px = 2*(1+1.25)=4.5 --
  // survives the pullback to 6.0, keeps riding.
  const bars = [bar(1, 12.0, 11.9, 12.0), bar(2, 12.0, 6.0, 6.0), bar(3, 9.0, 8.0, 8.0)];
  const shipped = replayRatchetExit(2.0, bars, T0, TIME_STOP);
  const wide = replayRatchetExit(2.0, bars, T0, TIME_STOP, { armPnlPct: 100, lockFraction: 0.25 });
  assert.equal(shipped.exitReason, "ratchet_floor");
  assert.equal(shipped.exitPx, 6.0);
  // Wide survives the bar-2 pullback to 6.0 (above its looser 4.5 floor) and holds to
  // time_stop at bar 3's close, well above the shipped exit's locked-in 6.0.
  assert.equal(wide.exitReason, "time_stop");
  assert.equal(wide.exitPx, 8.0);
  assert.ok(wide.exitPx > shipped.exitPx);
});
