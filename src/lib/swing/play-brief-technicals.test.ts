import { test } from "node:test";
import assert from "node:assert/strict";

import { technicalsBias } from "./play-brief-technicals";

/**
 * Dedicated coverage for `technicalsBias()`'s majority-vote logic (noted as a coverage gap in a
 * prior Ask Largo audit cycle — this is the follow-up, not a bug fix: the 4 call sites
 * (play-brief-intel.ts, play-brief-narrative.ts, play-brief-narrative-coaching.ts) were only
 * exercised indirectly through larger fixtures, with no test isolating the vote-counting rule
 * itself at its unanimous/majority/tie/partial-data boundaries).
 */

const T = (overrides: Partial<Parameters<typeof technicalsBias>[0]> = {}) =>
  ({
    vwap: null,
    emaStack: null,
    rsi: null,
    macd: null,
    goldenPocket: null,
    structure: null,
    ...overrides,
  }) as Parameters<typeof technicalsBias>[0];

test("technicalsBias: all 4 votes bullish -> bullish", () => {
  const t = T({ emaStack: "up", macd: "bull", structure: { type: "BOS", direction: "up", level: 100 } });
  assert.equal(technicalsBias(t, 101), "bullish");
});

test("technicalsBias: all 4 votes bearish -> bearish", () => {
  const t = T({ emaStack: "down", macd: "bear", structure: { type: "BOS", direction: "down", level: 100 } });
  assert.equal(technicalsBias(t, 99), "bearish");
});

test("technicalsBias: 3 bull vs 1 bear -> bullish (majority, not unanimity)", () => {
  const t = T({ emaStack: "up", macd: "bull", structure: { type: "CHOCH", direction: "down", level: 100 } });
  assert.equal(technicalsBias(t, 105), "bullish");
});

test("technicalsBias: 3 bear vs 1 bull -> bearish (majority, not unanimity)", () => {
  const t = T({ emaStack: "down", macd: "bear", structure: { type: "CHOCH", direction: "up", level: 100 } });
  assert.equal(technicalsBias(t, 95), "bearish");
});

test("technicalsBias: 2-2 tie (emaStack+macd bull, vwap+structure bear) -> neutral", () => {
  const t = T({
    vwap: 100,
    emaStack: "up",
    macd: "bull",
    structure: { type: "BOS", direction: "down", level: 100 },
  });
  assert.equal(technicalsBias(t, 99), "neutral");
});

test("technicalsBias: all readings absent/mixed -> neutral (no fabricated verdict)", () => {
  const t = T({ emaStack: "mixed" });
  assert.equal(technicalsBias(t, null), "neutral");
});

test("technicalsBias: structure direction other than up/down (e.g. unset string) casts no vote", () => {
  const t = T({ emaStack: "up", structure: { type: "BOS", direction: "sideways", level: 100 } });
  // emaStack contributes 1 bull vote, structure's non-up/down direction contributes nothing -> bullish
  assert.equal(technicalsBias(t, null), "bullish");
});

test("technicalsBias: vwap vote requires BOTH spot and vwap non-null", () => {
  // vwap present but spot null -> vwap cannot vote; only emaStack votes bull
  const t = T({ vwap: 100, emaStack: "up" });
  assert.equal(technicalsBias(t, null), "bullish");
});

test("technicalsBias: spot exactly at vwap counts as bullish (>=, not >)", () => {
  const t = T({ vwap: 100, emaStack: "down" }); // vwap bull (tie), emaStack bear -> neutral tie
  assert.equal(technicalsBias(t, 100), "neutral");
});

test("technicalsBias: single bullish vote with everything else absent -> bullish", () => {
  const t = T({ macd: "bull" });
  assert.equal(technicalsBias(t, null), "bullish");
});

test("technicalsBias: single bearish vote with everything else absent -> bearish", () => {
  const t = T({ macd: "bear" });
  assert.equal(technicalsBias(t, null), "bearish");
});
