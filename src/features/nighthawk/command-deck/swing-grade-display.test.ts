import assert from "node:assert/strict";
import { test } from "node:test";
import { playGradeLabel, playEntryInGradeColumn } from "./play-card-display";
import type { TerminalPlay } from "./types";

function swingPlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:INTC",
    ticker: "INTC",
    direction: "SHORT",
    contract: "90P · 4DTE",
    score: 62,
    status: "CLOSED",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    factors: [],
    gates: [],
    ...overrides,
  } as TerminalPlay;
}

test("playGradeLabel: swing rows map score to letter grade (not entry $)", () => {
  assert.equal(playGradeLabel(swingPlay({ score: 62 })), "A");
  assert.equal(playGradeLabel(swingPlay({ score: 72, tierLabel: "B" })), "B");
});

test("playEntryInGradeColumn: swings keep entry out of the Grade column", () => {
  assert.equal(playEntryInGradeColumn(swingPlay()), false);
  assert.equal(playEntryInGradeColumn(swingPlay({ horizon: "ZERO_DTE" } as TerminalPlay)), true);
});
