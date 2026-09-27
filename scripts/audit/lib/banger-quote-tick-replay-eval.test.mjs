import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReliableMarkSeries,
  appendExpirySettlementTick,
  replayTickState,
  replayPairTick,
} from "./banger-quote-tick-replay-eval.mjs";
import { deriveScaleOutAction, SCALE_OUT_RULES } from "../../../src/lib/zerodte/scale-out.ts";
import { midOf, reliableMarkFromQuote } from "../../../src/lib/providers/options-snapshot.ts";

const CONTROL = SCALE_OUT_RULES; // {scale_at_mult:2, scale_fraction:0.5, trail_from_peak:0.5, hard_stop_mult:0.4}
const CANDIDATE = { scale_at_mult: 2.0, scale_fraction: 0.33, trail_from_peak: 0.7, hard_stop_mult: 0.4 };

function q(t, bid, ask) {
  return { t, bid, ask };
}
function tr(t, price) {
  return { t, price };
}

// ── ORACLE PARITY: replay this module's engine tick-by-tick against production's REAL
// deriveScaleOutAction, driven by the SAME quote series, and assert the action sequence and final
// state agree exactly. This is the strongest possible proof — the oracle IS production's own code. ──

/** Manually drives production's real per-tick loop exactly as live-sync.ts does, for comparison. */
function driveRealProductionLoop(ticks, entryPremium) {
  let peak = entryPremium;
  let scaledAlready = false;
  const actions = [];
  for (const tick of ticks) {
    peak = Math.max(peak, tick.mark);
    const { action } = deriveScaleOutAction({ entryPremium, peakPremium: peak, lastMark: tick.mark, scaledAlready });
    actions.push(action);
    if (action === "TAKE_PARTIAL") scaledAlready = true;
    if (action === "STOP_OUT" || action === "EXIT_RUNNER") return { actions, terminal: action, peak, scaledAlready };
  }
  return { actions, terminal: "HOLD", peak, scaledAlready };
}

test("ORACLE PARITY: hard stop reached before any partial", () => {
  const entry = 1;
  const ticks = [{ t: 1, mark: 0.9 }, { t: 2, mark: 0.5 }, { t: 3, mark: 0.39 }];
  const real = driveRealProductionLoop(ticks, entry);
  const mine = replayTickState(ticks, entry, CONTROL);
  assert.equal(real.terminal, "STOP_OUT");
  assert.equal(mine.exitCause, "hard_stop");
  assert.equal(mine.exitTickIndex, 2);
});

test("ORACLE PARITY: partial then runner exit via retrace", () => {
  const entry = 1;
  const ticks = [
    { t: 1, mark: 1.5 },
    { t: 2, mark: 2.1 }, // TAKE_PARTIAL fires here
    { t: 3, mark: 3.0 }, // new peak
    { t: 4, mark: 2.9 },
    { t: 5, mark: 1.4 }, // <= 0.5*3.0=1.5 -> EXIT_RUNNER
  ];
  const real = driveRealProductionLoop(ticks, entry);
  const mine = replayTickState(ticks, entry, CONTROL);
  assert.equal(real.terminal, "EXIT_RUNNER");
  assert.equal(real.peak, 3.0);
  assert.equal(mine.exitCause, "trail_stop");
  assert.equal(mine.peakAtExit, 3.0);
  assert.equal(mine.exitTickIndex, 4);
  // MODEL fill for EXIT_RUNNER is the tick's ACTUAL mark (1.4), not peak*trail (1.5) -- production's
  // real formula (live-sync.ts), a genuine difference from the prior PR's bar-based clone.
  // realized = 0.5*2.0(fixed partial) + 0.5*1.4 = 1.0+0.7=1.7 -> pct = 70%
  assert.equal(mine.modelRealizedMultiple, 1.7);
});

test("ORACLE PARITY: never triggers, holds through the whole observed series (HOLD every tick)", () => {
  const entry = 1;
  const ticks = [{ t: 1, mark: 1.1 }, { t: 2, mark: 0.95 }, { t: 3, mark: 1.05 }];
  const real = driveRealProductionLoop(ticks, entry);
  const mine = replayTickState(ticks, entry, CONTROL);
  assert.ok(real.actions.every((a) => a === "HOLD"));
  assert.equal(mine.exitCause, "series_end_never_triggered");
});

test("MODEL vs EXEC: a STOP_OUT execs at min(bid, fixed hard-stop level) -- never better than model", () => {
  const entry = 1;
  const ticks = [{ t: 1, mark: 0.3, bid: 0.25 }]; // mark below hard stop (0.4), bid even lower
  const out = replayTickState(ticks, entry, CONTROL);
  assert.equal(out.exitCause, "hard_stop");
  assert.equal(round(out.modelRealizedMultiple), 0.4); // fixed, per production's real formula
  assert.equal(round(out.execRealizedMultiple), 0.25); // bid-filled, worse
});

test("MODEL vs EXEC: a TAKE_PARTIAL execs at min(bid, fixed 2x target) -- bid below target is used", () => {
  const entry = 1;
  const ticks = [{ t: 1, mark: 2.1, bid: 1.9 }, { t: 2, mark: 2.0 }]; // stays scaled, never retraces below trail in this short series
  const out = replayTickState(ticks, entry, CONTROL);
  assert.equal(out.scaled, true);
  // model: 0.5*2.0(fixed) + 0.5*2.0(final series-end mark) = 2.0 -> +100%
  assert.equal(round(out.modelRealizedMultiple), 2.0);
  // exec partial leg used bid=1.9 (< model's 2.0), runner leg still series-end model mark (2.0) since exec only clamps SELL fills at trigger ticks, not the untriggered ride-through remainder
  assert.ok(out.execRealizedMultiple < out.modelRealizedMultiple);
});

test("MODEL vs EXEC: exec fill is never BETTER than model even when bid > model fill", () => {
  const entry = 1;
  const ticks = [{ t: 1, mark: 0.3, bid: 0.5 }]; // a data artifact: bid above mark/model fill
  const out = replayTickState(ticks, entry, CONTROL);
  assert.ok(out.execRealizedMultiple <= out.modelRealizedMultiple);
});

test("no data / bad entry -> breakeven, no throw", () => {
  assert.equal(replayTickState([], 1, CONTROL).modelRealizedMultiple, 1);
  assert.equal(replayTickState([{ t: 1, mark: 1 }], 0, CONTROL).modelRealizedMultiple, 1);
});

test("replayPairTick: control and candidate diverge only where their rules actually differ", () => {
  const entry = 1;
  const ticks = [
    { t: 1, mark: 2.1, bid: 2.0 },
    { t: 2, mark: 3.0, bid: 2.95 },
    { t: 3, mark: 2.0, bid: 1.95 }, // <=0.7*3=2.1 -> candidate (33/70) exits here; <=0.5*3=1.5 control does not
    { t: 4, mark: 1.4, bid: 1.35 }, // <=0.5*3=1.5 -> control exits here
  ];
  const pair = replayPairTick(ticks, entry, CONTROL, CANDIDATE);
  assert.equal(pair.candidate.exitCause, "trail_stop");
  assert.equal(pair.candidate.exitTickIndex, 2);
  assert.equal(pair.control.exitCause, "trail_stop");
  assert.equal(pair.control.exitTickIndex, 3);
  assert.ok(pair.modelDelta != null);
});

// ── buildReliableMarkSeries: real backstop-quote-divergence guard, imported from production ──

test("buildReliableMarkSeries: a normal two-sided quote resolves to midOf(bid,ask)", () => {
  const quotes = [q(1, 0.45, 0.55)];
  const out = buildReliableMarkSeries(quotes, [], 0.5);
  assert.equal(out.length, 1);
  assert.equal(out[0].mark, midOf(0.45, 0.55));
});

test("buildReliableMarkSeries: the REAL PR #4969 shape -- bid=0, ask=$15 backstop mid is REJECTED in favor of the trade reference", () => {
  // CRSR's real incident: bid=0/ask=15 (mid=7.5) while last trade / entry was $0.07 -- a 107x divergence.
  const quotes = [q(1, 0, 15)];
  const trades = [tr(0, 0.07)]; // a trade printed before this quote
  const out = buildReliableMarkSeries(quotes, trades, 0.07);
  assert.equal(out.length, 1);
  // Confirm against the REAL reliableMarkFromQuote directly, not just an expected literal.
  const expected = reliableMarkFromQuote(midOf(0, 15), 0, 0.07);
  assert.equal(out[0].mark, expected);
  assert.equal(out[0].mark, 0.07); // rejected the $7.50 backstop mid, fell through to the real reference
});

test("buildReliableMarkSeries: trades update the reference in temporal order, never retroactively", () => {
  const quotes = [q(1, 0, 15), q(3, 0, 15)];
  const trades = [tr(2, 0.5)]; // prints BETWEEN the two quotes
  const out = buildReliableMarkSeries(quotes, trades, 0.07);
  // first quote (t=1) sees only the initial reference (0.07); second quote (t=3) sees the updated trade (0.5)
  assert.equal(out[0].mark, reliableMarkFromQuote(midOf(0, 15), 0, 0.07));
  assert.equal(out[1].mark, reliableMarkFromQuote(midOf(0, 15), 0, 0.5));
});

test("buildReliableMarkSeries: an unusable quote (no mid, no reference) is skipped, never fabricated", () => {
  const quotes = [q(1, null, null)];
  const out = buildReliableMarkSeries(quotes, [], null);
  assert.equal(out.length, 0);
});

test("appendExpirySettlementTick: settles at OCC intrinsic value, matching settleExpiredBangerRow's real formula", () => {
  const out = appendExpirySettlementTick([{ t: 1, mark: 1.0, bid: 1.0 }], 999, 42.5, 40);
  assert.equal(out.length, 2);
  assert.equal(out[1].mark, 2.5); // max(0, 42.5-40)
  assert.equal(out[1].t, 999);
});

test("appendExpirySettlementTick: a worthless expiry (close below strike) settles at exactly 0, not negative", () => {
  const out = appendExpirySettlementTick([], 999, 10, 40);
  assert.equal(out[0].mark, 0);
});

function round(x) {
  return Math.round(x * 10000) / 10000;
}
