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

test("isSetupInvalidated: spot above ceiling invalidates fade", () => {
  const r = isSetupInvalidated(7610, "5m close > 7,600", "short", 7600, 7500, null);
  assert.equal(r.invalidated, true);
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
