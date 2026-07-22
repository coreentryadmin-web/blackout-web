import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulateStrikes, flowAccumulationByTicker, type FlowAlertRow } from "./flow-accumulation";

// ET-noon anchor so createdAt lands cleanly inside a trading day.
const NOW = Date.parse("2026-07-22T17:00:00Z"); // ~13:00 ET
const DAY = 86_400_000;
const daysAgo = (d: number) => NOW - d * DAY;

function row(over: Partial<FlowAlertRow> = {}): FlowAlertRow {
  return {
    ticker: "NVDA",
    strike: 900,
    expiry: "2026-07-24",
    side: "call",
    premium: 1_000_000,
    askSidePremium: 900_000, // aggressive buyer by default
    bidSidePremium: 100_000,
    sweep: true,
    opening: true,
    volOiRatio: 2,
    createdAtMs: NOW,
    ...over,
  };
}

test("stacked hits ACROSS DAYS outscore a single same-premium print (persistence dominates)", () => {
  // Same total weighted premium, but spread over 3 distinct days vs one big day.
  const stacked = [
    row({ premium: 1_000_000, askSidePremium: 900_000, bidSidePremium: 100_000, createdAtMs: daysAgo(0) }),
    row({ premium: 1_000_000, askSidePremium: 900_000, bidSidePremium: 100_000, createdAtMs: daysAgo(1) }),
    row({ premium: 1_000_000, askSidePremium: 900_000, bidSidePremium: 100_000, createdAtMs: daysAgo(2) }),
  ];
  const oneShot = [
    row({ ticker: "AMD", strike: 200, premium: 3_000_000, askSidePremium: 2_700_000, bidSidePremium: 300_000, createdAtMs: daysAgo(0) }),
  ];
  const s = accumulateStrikes([...stacked, ...oneShot], NOW);
  const nvda = s.find((x) => x.ticker === "NVDA")!;
  const amd = s.find((x) => x.ticker === "AMD")!;
  assert.equal(nvda.days, 3, "NVDA identity hit on 3 distinct days");
  assert.equal(amd.days, 1, "AMD single day");
  assert.ok(nvda.score > amd.score, `stacked (${nvda.score}) must outscore one-shot (${amd.score})`);
});

test("direction is signed by the AGGRESSOR (ask-side calls = bull, ask-side puts = bear)", () => {
  const bullCalls = flowAccumulationByTicker(
    [row({ ticker: "AAA", side: "call", askSidePremium: 1_000_000, bidSidePremium: 0 })],
    NOW
  ).get("AAA")!;
  assert.equal(bullCalls.direction, "bull");

  const bearPuts = flowAccumulationByTicker(
    [row({ ticker: "BBB", side: "put", askSidePremium: 1_000_000, bidSidePremium: 0 })],
    NOW
  ).get("BBB")!;
  assert.equal(bearPuts.direction, "bear");

  // Selling calls (bid-side) is bearish, not bullish.
  const soldCalls = flowAccumulationByTicker(
    [row({ ticker: "CCC", side: "call", askSidePremium: 0, bidSidePremium: 1_000_000 })],
    NOW
  ).get("CCC")!;
  assert.equal(soldCalls.direction, "bear", "aggressively SOLD calls read bearish");
});

test("magnet = the strongest accumulated strike on the dominant side", () => {
  const rows = [
    // Big multi-day call build at 900 (the magnet)
    row({ strike: 900, createdAtMs: daysAgo(0) }),
    row({ strike: 900, createdAtMs: daysAgo(1) }),
    row({ strike: 900, createdAtMs: daysAgo(2) }),
    // Smaller one-day build at 950
    row({ strike: 950, premium: 400_000, askSidePremium: 350_000, bidSidePremium: 50_000, createdAtMs: daysAgo(0) }),
  ];
  const sig = flowAccumulationByTicker(rows, NOW).get("NVDA")!;
  assert.equal(sig.direction, "bull");
  assert.equal(sig.magnet?.strike, 900, "the multi-day 900 build is the magnet");
});

test("recency decay: an old hit weighs less than a fresh one of equal premium", () => {
  const fresh = accumulateStrikes([row({ ticker: "F", createdAtMs: daysAgo(0) })], NOW)[0]!;
  const old = accumulateStrikes([row({ ticker: "O", createdAtMs: daysAgo(6) })], NOW)[0]!;
  assert.ok(fresh.weightedPremium > old.weightedPremium, "fresh premium weighs more after decay");
});

test("neutral when net signed premium is below the floor (mixed/small flow)", () => {
  const mixed = flowAccumulationByTicker(
    [
      row({ ticker: "M", side: "call", premium: 100_000, askSidePremium: 60_000, bidSidePremium: 40_000 }),
      row({ ticker: "M", side: "put", premium: 100_000, askSidePremium: 60_000, bidSidePremium: 40_000 }),
    ],
    NOW
  ).get("M")!;
  assert.equal(mixed.direction, "neutral");
});

test("no ask/bid split → falls back to HALF the directional weight of a confirmed ask-side buy", () => {
  const same = { ticker: "H", premium: 2_000_000, createdAtMs: NOW } as const;
  const noSplit = accumulateStrikes([row({ ...same, askSidePremium: null, bidSidePremium: null })], NOW)[0]!;
  const fullAsk = accumulateStrikes([row({ ...same, askSidePremium: 2_000_000, bidSidePremium: 0 })], NOW)[0]!;
  assert.ok(noSplit.signedPremium > 0, "calls with no split read mildly bullish");
  // Same premium + same aggression multipliers → the only difference is the 0.5 fallback weight.
  assert.ok(
    Math.abs(noSplit.signedPremium - fullAsk.signedPremium * 0.5) < 1,
    `no-split (${noSplit.signedPremium}) should be ~half of confirmed ask-side (${fullAsk.signedPremium})`
  );
});
