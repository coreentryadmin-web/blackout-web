import { test } from "node:test";
import assert from "node:assert/strict";

import { readDarkPoolBias } from "@/features/helix/lib/helix-darkpool-bias";
import { MIN_READABLE_PCT_FOR_VERDICT } from "@/features/helix/lib/helix-direction-read";

const buy = (premium: number) => ({ side: "buy", premium });
const sell = (premium: number) => ({ side: "sell", premium });
const neutral = (premium: number) => ({ side: "neutral", premium });

test("the defect: a verdict must NOT be drawn from a sided minority", () => {
  // The shape the old inline `buy / (buy + sell)` produced. 5% of premium is sided and leans buy;
  // the old ratio saw 1.0 and rendered a confident BULLISH over a twentieth of the tape.
  const read = readDarkPoolBias([buy(500_000), neutral(9_500_000)]);
  assert.equal(read.label, "unreadable");
  assert.equal(read.minorityEvidence, true);
  assert.equal(read.readablePct, 5);
  // The discarded slice is reported, not just excluded.
  assert.equal(read.neutralPremium, 9_500_000);
});

test("a majority-readable population still gets a verdict", () => {
  const read = readDarkPoolBias([buy(8_000_000), sell(1_000_000), neutral(1_000_000)]);
  assert.equal(read.label, "BULLISH");
  assert.equal(read.minorityEvidence, false);
  assert.equal(read.readablePct, 90);
});

test("the threshold is the SHARED one, not a second copy", () => {
  // #2731 was a whole PR about a harness keeping its own copy of a product rule. Exactly at the
  // threshold the verdict is allowed; a hair below it is refused.
  const at = readDarkPoolBias([buy(MIN_READABLE_PCT_FOR_VERDICT), neutral(100 - MIN_READABLE_PCT_FOR_VERDICT)]);
  assert.equal(at.readablePct, MIN_READABLE_PCT_FOR_VERDICT);
  assert.equal(at.minorityEvidence, false);
  const below = readDarkPoolBias([buy(MIN_READABLE_PCT_FOR_VERDICT - 1), neutral(101 - MIN_READABLE_PCT_FOR_VERDICT)]);
  assert.equal(below.minorityEvidence, true);
});

test("BEARISH and MIXED are still reachable above the gate", () => {
  assert.equal(readDarkPoolBias([buy(1_000_000), sell(9_000_000)]).label, "BEARISH");
  assert.equal(readDarkPoolBias([buy(5_000_000), sell(5_000_000)]).label, "MIXED");
});

test("MIXED and unreadable stay different facts", () => {
  // MIXED = read successfully, genuinely two-sided. unreadable = not enough was readable to say.
  // Collapsing them is the conflation §5c of the market-open runbook keeps having to undo.
  assert.equal(readDarkPoolBias([buy(5_000_000), sell(5_000_000)]).label, "MIXED");
  assert.equal(readDarkPoolBias([neutral(5_000_000)]).label, "unreadable");
});

test("today's live population: every print neutral renders a refusal, unchanged from before", () => {
  // Measured 2026-08-23 across the market-wide feed and NVDA/SPY/TSLA/AAPL: 250 prints, all
  // neutral, 0.0% sided coverage. This change must be behaviour-neutral there.
  const read = readDarkPoolBias(Array.from({ length: 50 }, () => neutral(2_000_000)));
  assert.equal(read.label, "unreadable");
  assert.equal(read.readablePct, 0);
});

test("an empty population reports null coverage, never 0%", () => {
  // 0% would read as "measured, none readable" when nothing was measured at all.
  const read = readDarkPoolBias([]);
  assert.equal(read.readablePct, null);
  assert.equal(read.label, "unreadable");
});

test("non-finite and non-positive premium is skipped, not counted as neutral evidence", () => {
  const read = readDarkPoolBias([
    buy(8_000_000), sell(2_000_000),
    { side: "neutral", premium: Number.NaN },
    { side: "neutral", premium: 0 },
    { side: "neutral", premium: -5 },
  ]);
  assert.equal(read.neutralPremium, 0);
  assert.equal(read.readablePct, 100);
  assert.equal(read.label, "BULLISH");
});

test("an unmapped side value counts as UNREAD, never as buy or sell", () => {
  // The route maps missing direction to "neutral", but the else-branch is deliberately broad so a
  // value nobody anticipated cannot silently land on one side of the ratio.
  const read = readDarkPoolBias([buy(1_000_000), { side: "BUY_TO_OPEN", premium: 9_000_000 }]);
  assert.equal(read.buyPremium, 1_000_000);
  assert.equal(read.neutralPremium, 9_000_000);
  assert.equal(read.label, "unreadable");
});
