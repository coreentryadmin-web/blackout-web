import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVectorPickLiveStatus,
  formatPickPremiumDriftPct,
  isSetupInvalidated,
  parseInvalidationLevel,
  pinVectorPickEntryMid,
  premiumDriftPct,
  resolveVectorPickLiveMid,
} from "./vector-pick-live-status";
import { effectivePickBias } from "./vector-pick-effective-bias";

test("formatPickPremiumDriftPct: signed whole-percent", () => {
  assert.equal(formatPickPremiumDriftPct(12.4), "+12%");
  assert.equal(formatPickPremiumDriftPct(-8.2), "-8%");
  assert.equal(formatPickPremiumDriftPct(null), null);
});

test("parseInvalidationLevel extracts numeric level", () => {
  assert.equal(parseInvalidationLevel("5m close > 7,600 (wall breaks)"), 7600);
});

// REGRESSION (2026-08-29 audit finding): Vector is not restricted to a preset ticker
// universe (isVectorTickerAllowed accepts any optionable symbol), so a real sub-$10 spot
// price is a reachable case, not noise — the old `n >= 10` floor silently dropped it.
test("parseInvalidationLevel: a sub-$10 level parses (no arbitrary floor beyond timeframe tokens)", () => {
  assert.equal(parseInvalidationLevel("5m close < 8.50 (wall breaks → support lost)"), 8.5);
  assert.equal(parseInvalidationLevel("15m close > 3.25"), 3.25);
});

test("isSetupInvalidated: spot above ceiling invalidates fade", () => {
  const r = isSetupInvalidated(7620, "5m close > 7,600", "short", 7600, 7500, null);
  assert.equal(r.invalidated, true);
});

test("isSetupInvalidated: sub-tick pierce below buffer does NOT invalidate (2026-09-01 IWM/AAPL noise)", () => {
  const r = isSetupInvalidated(325.46, "5m close > 325", "short", null, null, null);
  assert.equal(r.invalidated, false, "0.14% pierce should not fire with 0.15% buffer");
  const r2 = isSetupInvalidated(290.67, "5m close < 291", "long", null, null, null);
  assert.equal(r2.invalidated, false, "0.11% dip should not fire with 0.15% buffer");
});

test("isSetupInvalidated: range fade-dip invalidates when spot breaks put wall", () => {
  const r = isSetupInvalidated(566, "5m close < 570", "range", 580, 570, null, "fade-dip");
  assert.equal(r.invalidated, true);
  assert.equal(r.level, 570);
});

test("isSetupInvalidated: range fade-dip does NOT invalidate on call-wall side noise", () => {
  const r = isSetupInvalidated(578, "5m close < 570", "range", 580, 570, null, "fade-dip");
  assert.equal(r.invalidated, false);
});

test("isSetupInvalidated: a sub-$10 ticker's invalidation level still fires (was silently unreachable)", () => {
  const r = isSetupInvalidated(8.6, "5m close > 8.50 (wall breaks → fade void)", "short", null, null, null);
  assert.equal(r.invalidated, true);
  assert.equal(r.level, 8.5);
});

test("evaluateVectorPickLiveStatus: still_buy on fresh quote near entry", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 576,
    side: "call",
    entryMid: 3.25,
    quote: { bid: 3.2, ask: 3.5, mid: 3.35, delta: 0.42 },
    invalidation: "5m close < 570",
    bias: "long",
    putWall: 570,
  });
  assert.equal(r.status, "still_buy");
});

test("evaluateVectorPickLiveStatus: dont_buy when premium extended", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 576,
    side: "call",
    entryMid: 3.0,
    quote: { bid: 3.8, ask: 4.0, mid: 3.9, delta: 0.42 },
    bias: "long",
  });
  assert.equal(r.status, "dont_buy");
  assert.match(r.reason, /extended/i);
});

test("evaluateVectorPickLiveStatus: tracked intent — +200% winner is caution, not dont_buy (2026-09-01 AAPL)", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 230,
    side: "call",
    entryMid: 1.5,
    quote: { bid: 4.4, ask: 4.8, mid: 4.6, delta: 0.55 },
    bias: "long",
    intent: "tracked",
  });
  assert.equal(r.status, "caution");
  assert.match(r.reason, /manage exit/i);
  assert.equal(r.setupInvalidated, false);
});

test("evaluateVectorPickLiveStatus: tracked intent — +30% extended is caution, not chase-risk close", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 576,
    side: "call",
    entryMid: 3.0,
    quote: { bid: 3.8, ask: 4.0, mid: 3.9, delta: 0.42 },
    bias: "long",
    intent: "tracked",
  });
  assert.equal(r.status, "caution");
  assert.match(r.reason, /limit only/i);
});

test("evaluateVectorPickLiveStatus: sub-$0.10 entry with wild % is caution, not chase risk", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 12,
    side: "call",
    entryMid: 0.05,
    quote: { bid: 0.12, ask: 0.16, mid: 0.14, delta: 0.35 },
    bias: "long",
    intent: "fresh_entry",
  });
  assert.equal(r.status, "caution");
  assert.match(r.reason, /verify premium/i);
});

test("evaluateVectorPickLiveStatus: bar close prevents tick-noise invalidation (2026-09-01 AAPL)", () => {
  const tf = 5;
  const tfSec = tf * 60;
  const nowMs = (tfSec * 4 + 120) * 1000;
  const bucketStart = Math.floor(nowMs / 1000 / tfSec) * tfSec - tfSec;
  const bars = [
    { time: bucketStart, open: 324, high: 325, low: 323.5, close: 324.2 },
    { time: bucketStart + 60, open: 324.2, high: 324.6, low: 324, close: 324.5 },
  ];
  const r = evaluateVectorPickLiveStatus({
    spot: 325.46,
    side: "put",
    entryMid: 2.5,
    quote: { bid: 2.1, ask: 2.3, mid: 2.2, delta: -0.4 },
    invalidation: "5m close > 325",
    bias: "short",
    bars,
    nowMs,
    intent: "tracked",
  });
  assert.equal(r.setupInvalidated, false);
});

test("evaluateVectorPickLiveStatus: dont_buy when setup invalidated and premium not favorable", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 568,
    side: "call",
    entryMid: 3.2,
    quote: { bid: 2.8, ask: 3.0, mid: 2.9, delta: 0.3 },
    invalidation: "5m close < 570",
    bias: "long",
    putWall: 570,
  });
  assert.equal(r.status, "dont_buy");
  assert.equal(r.setupInvalidated, true);
});

test("evaluateVectorPickLiveStatus: caution when setup invalidated but premium still +15%", () => {
  const r = evaluateVectorPickLiveStatus({
    spot: 568,
    side: "put",
    entryMid: 1.0,
    quote: { bid: 3.4, ask: 3.8, mid: 3.6, delta: -0.4 },
    invalidation: "5m close < 570",
    bias: "long",
    putWall: 570,
  });
  assert.equal(r.status, "caution");
  assert.equal(r.setupInvalidated, true);
  assert.match(r.reason, /manage exit/i);
});

test("resolveVectorPickLiveMid: prefers bid/ask mid over a stale last-trade mark", () => {
  assert.equal(
    resolveVectorPickLiveMid({ bid: 3.2, ask: 3.6, mark: 1.05 }),
    3.4
  );
});

test("resolveVectorPickLiveMid: falls back to mark when quotes are one-sided", () => {
  assert.equal(resolveVectorPickLiveMid({ bid: null, ask: 2.5, mark: 2.5 }), 2.5);
});

test("premiumDriftPct matches pinnedLivePnlPct rounding", () => {
  assert.equal(premiumDriftPct(4.0, 4.5), 12.5);
});

test("pinVectorPickEntryMid: keeps first anchor across refreshes", () => {
  const pinned = new Map<string, number>();
  assert.equal(pinVectorPickEntryMid(pinned, "O:NVDA", 3.25), 3.25);
  assert.equal(pinVectorPickEntryMid(pinned, "O:NVDA", 3.8), 3.25);
});

// ── REGRESSION (2026-08-29 audit finding): a committed pivot play's raw card bias is always
// "neutral", so isSetupInvalidated's bias-gated branches ("back through", put/call wall breaks)
// can never fire for the whole pivot setup class unless the caller re-derives the EFFECTIVE
// (committed) bias via effectivePickBias first — exactly what the contract-picks/live route now
// does before calling evaluateVectorPickLiveStatus. This pins the composition, not just the pure
// pieces in isolation.
test("isSetupInvalidated: raw neutral bias from an uncommitted pivot play never invalidates on a 'back through' break", () => {
  const spot = 7490; // closed back below the flip
  const invalidation = "5m close back through 7495.51";
  // Passing the raw card bias (what the route did before the fix) — always "neutral" for pivot.
  const withRawBias = isSetupInvalidated(spot, invalidation, "neutral", null, null, 7495.51);
  assert.equal(withRawBias.invalidated, false, "raw neutral bias silently swallows the break");
});

test("isSetupInvalidated + effectivePickBias: a COMMITTED pivot play (spot cleared the flip, generated a real long pick) invalidates when spot closes back through the flip", () => {
  const play = { bias: "neutral" as const, setup: "pivot" as const };
  // Spot had committed long (0.3% above the flip -> effectivePickBias returns "long", matching
  // what vector-play-candidates.ts used to rank a real call contract).
  const committedBias = effectivePickBias(play, 7517, 7495.51);
  assert.equal(committedBias, "long", "sanity: spot must have actually committed for this scenario");

  const spot = 7490; // reverses and closes back below the flip -- the play's own thesis failure
  const invalidation = "5m close back through 7495.51";
  const result = isSetupInvalidated(spot, invalidation, committedBias, null, null, 7495.51);
  assert.equal(result.invalidated, true, "the effective (committed) bias must let the break invalidate the setup");
  assert.equal(result.level, 7495.51);
});

test("evaluateVectorPickLiveStatus: end-to-end, a committed pivot pick reports dont_buy once spot reverses through the flip", () => {
  const play = { bias: "neutral" as const, setup: "pivot" as const };
  const committedBias = effectivePickBias(play, 7517, 7495.51);
  const evalResult = evaluateVectorPickLiveStatus({
    spot: 7490,
    side: "call",
    entryMid: 3.5,
    invalidation: "5m close back through 7495.51",
    bias: committedBias ?? undefined,
    gammaFlip: 7495.51,
    quote: { bid: 3.4, ask: 3.6, mid: 3.5, delta: 0.4 },
  });
  assert.equal(evalResult.setupInvalidated, true);
  assert.equal(evalResult.status, "dont_buy");
});
