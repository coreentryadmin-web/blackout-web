import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyScorecardBadge, legacyScorecardLine } from "./legacy-board-detail-copy";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

function play(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "t",
    ticker: "NVDA",
    direction: "LONG",
    horizon: "LEGACY",
    status: "OPEN",
    recommendation: "BUY",
    contract: "180C",
    ...overrides,
  } as TerminalPlay;
}

test("legacyScorecardLine returns null when the play carries no scorecard", () => {
  assert.equal(legacyScorecardLine(play()), null);
});

test("legacyScorecardLine formats win rate, CI, avg return, n, and tier-bucket scope", () => {
  const line = legacyScorecardLine(
    play({ scorecard: { winRate: 62.5, avg: 3.4, n: 14, ciLow: 40, ciHigh: 80, scope: "conviction_bucket" } })
  );
  assert.equal(line, "63% WR (95% CI 40–80%) · avg +3% · n=14 · tier bucket");
});

test("legacyScorecardLine omits the CI clause when ciLow/ciHigh are absent", () => {
  const line = legacyScorecardLine(play({ scorecard: { winRate: 50, avg: -1.2, n: 6 } }));
  assert.equal(line, "50% WR · avg -1% · n=6");
});

test("legacyScorecardBadge returns null when the play carries no scorecard", () => {
  assert.equal(legacyScorecardBadge(play()), null);
});

test("legacyScorecardBadge is the compact table-row form: rounded win rate + n, no CI/avg/scope clutter", () => {
  const badge = legacyScorecardBadge(
    play({ scorecard: { winRate: 62.5, avg: 3.4, n: 14, ciLow: 40, ciHigh: 80, scope: "conviction_bucket" } })
  );
  assert.equal(badge, "63% WR · n=14");
});

test("legacyScorecardBadge never fabricates a rate without the n that produced it", () => {
  const badge = legacyScorecardBadge(play({ scorecard: { winRate: 0, avg: 0, n: 0 } }));
  assert.equal(badge, "0% WR · n=0", "n=0 is shown verbatim, never hidden -- a caller must be able to see the sample size is empty");
});
