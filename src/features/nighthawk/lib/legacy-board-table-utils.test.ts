import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  buildLegacyBoardRows,
  legacyBoardCalendarBuckets,
  terminalPlayToLegacyRow,
} from "@/features/nighthawk/lib/legacy-board-table-utils";

function basePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "LEGACY-AAPL",
    ticker: "AAPL",
    contract: "AAPL 200C 3/21",
    direction: "CALL",
    status: "OPEN",
    recommendation: "BUY",
    rank: 1,
    factors: [],
    gates: [],
    thesisBreak: null,
    ...overrides,
  } as TerminalPlay;
}

test("terminalPlayToLegacyRow maps premium and session fields", () => {
  const row = terminalPlayToLegacyRow(
    basePlay({
      entryCostPerContract: 2.5,
      mark: 3.1,
      pnlPct: 24,
      tierLabel: "A",
      edition_for: undefined,
    }),
    "2026-03-01"
  );
  assert.equal(row.ticker, "AAPL");
  assert.equal(row.sessionDate, "2026-03-01");
  assert.equal(row.premiumPct, 24);
  assert.equal(row.tier, "elite");
  assert.equal(row.entryMid, 2.5);
  assert.equal(row.markMid, 3.1);
});

test("buildLegacyBoardRows splits open vs closed", () => {
  const plays = [
    basePlay({ id: "open-1", status: "OPEN" }),
    basePlay({ id: "closed-1", status: "SKIP", ticker: "MSFT" }),
  ];
  const open = buildLegacyBoardRows(plays, "open", "2026-03-01");
  const closed = buildLegacyBoardRows(plays, "closed", "2026-03-01");
  assert.equal(open.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(open[0]?.ticker, "AAPL");
  assert.equal(closed[0]?.ticker, "MSFT");
});

// ── The calendar strip's own "Net premium" tile has the identical phantom-win bug the session
// scorecard had (vector-board-row-utils.ts, PR #4742) — a SKIP/pulled play's counterfactual
// premiumPct blended into a plain day average. Measured live, 2026-09-10: with real SIG -82% and
// FICO +29%, the SEP 10 tile read +109.7%, driven entirely by a pulled ASO's +300%-range
// counterfactual; the honest average excluding it was -26.5%. ─────────────────────────────────

test("legacyBoardCalendarBuckets excludes a pulled play's counterfactual from net_premium_pct and winners", () => {
  const plays = [
    basePlay({ id: "sig", ticker: "SIG", status: "OPEN", pnlPct: -82 }),
    basePlay({ id: "fico", ticker: "FICO", status: "OPEN", pnlPct: 29 }),
    basePlay({ id: "aso", ticker: "ASO", status: "SKIP", pnlPct: 306.67 }),
  ];
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, "2026-09-10"));
  assert.equal(rows[2]?.statusLabel, "PULLED", "fixture sanity: SKIP must map to the PULLED label");

  const buckets = legacyBoardCalendarBuckets(rows, ["2026-09-10"]);
  const today = buckets[0]!;
  assert.equal(today.n, 3, "the raw play count still includes the pull");
  // Honest average over the two real rows: (-82 + 29) / 2 = -26.5.
  assert.ok(
    today.net_premium_pct < 0 && today.net_premium_pct > -60,
    `expected the honest negative average (~-26.5), got ${today.net_premium_pct}`
  );
  assert.equal(today.winners, 0, "the pulled play's phantom +306% must not count as a winner tile");
});

test("legacyBoardCalendarBuckets: closed count still includes the pull (tab-count parity, same as the scorecard fix)", () => {
  const plays = [basePlay({ id: "aso", ticker: "ASO", status: "SKIP", pnlPct: 306.67 })];
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, "2026-09-10"));
  const buckets = legacyBoardCalendarBuckets(rows, ["2026-09-10"]);
  assert.equal(buckets[0]?.closed, 1);
  assert.equal(buckets[0]?.net_premium_pct, 0, "no real resolution that day — never a fabricated positive tile");
});
