import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  buildLegacyBoardRows,
  legacyBoardCalendarBuckets,
  terminalPlayToLegacyRow,
} from "@/features/nighthawk/lib/legacy-board-table-utils";
import { vectorBoardScorecard } from "@/features/nighthawk/lib/vector-board-row-utils";

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

// ── The tile's render layer (VectorBoardCalendar.tsx's fmtSigned) interpolates net_premium_pct
// as-is with no rounding, so an un-rounded average here prints raw float noise. Measured live,
// 2026-09-10: real SIG/FICO premiums (-80.73%/+24.19%) averaged to a tile reading
// "-28.2700000000000004%" once the pulled-play fix above landed without this rounding. ─────────

// ── legacyVectorStatus never emitted "winner"/"runner" — only vectorBoardScorecard's shared
// aggregation (winners/runners/winnersFloorPct/runnerPipelinePct) reads `status`, so those four
// figures were structurally always zero for every Legacy row regardless of real performance.
// Live evidence, 2026-09-10: FICO open at +24.19% (clears the same 15% threshold legacyRowKind
// already uses for `kind`) still showed "0 runners" on the live scorecard. ───────────────────────

test("terminalPlayToLegacyRow: an open play crossing +50% reports status winner", () => {
  const row = terminalPlayToLegacyRow(basePlay({ status: "OPEN", pnlPct: 62 }), "2026-09-10");
  assert.equal(row.status, "winner");
  assert.equal(row.statusLabel, "Winner");
});

test("terminalPlayToLegacyRow: an open play crossing +15% (but under +50%) reports status runner", () => {
  const row = terminalPlayToLegacyRow(basePlay({ status: "OPEN", pnlPct: 24.19 }), "2026-09-10");
  assert.equal(row.status, "runner");
  assert.equal(row.statusLabel, "Runner");
});

test("terminalPlayToLegacyRow: an open play under +15% stays plain open, no upgrade", () => {
  const row = terminalPlayToLegacyRow(basePlay({ status: "OPEN", pnlPct: -5 }), "2026-09-10");
  assert.equal(row.status, "open");
});

test("terminalPlayToLegacyRow: a WATCH play is never upgraded even with a stray pnlPct", () => {
  const row = terminalPlayToLegacyRow(basePlay({ status: "WATCH", pnlPct: 90 }), "2026-09-10");
  assert.equal(row.status, "open");
  assert.equal(row.statusLabel, "WATCH");
});

test("terminalPlayToLegacyRow: a caution-flagged play is never upgraded by a high pnlPct", () => {
  const row = terminalPlayToLegacyRow(
    basePlay({ status: "OPEN", horizon: "LEGACY", morningStatus: "DEGRADED", pnlPct: 90 }),
    "2026-09-10"
  );
  assert.equal(row.status, "caution");
  assert.equal(row.statusLabel, "DEGRADED");
});

test("vectorBoardScorecard: legacy rows with a real runner now count toward runners/runnerPipelinePct (live SIG/FICO figures)", () => {
  const plays = [
    basePlay({ id: "sig", ticker: "SIG", status: "OPEN", pnlPct: -80.73 }),
    basePlay({ id: "fico", ticker: "FICO", status: "OPEN", pnlPct: 24.19 }),
  ];
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, "2026-09-10"));
  const sc = vectorBoardScorecard(rows);
  assert.equal(sc.runners, 1, "FICO at +24.19% must count as a runner");
  assert.equal(sc.winners, 0);
  assert.equal(sc.runnerPipelinePct, 50, "1 of 2 open rows is a runner");
  assert.equal(sc.winnersFloorPct, 0);
});

test("legacyBoardCalendarBuckets rounds net_premium_pct to an integer (no float-noise digits)", () => {
  const plays = [
    basePlay({ id: "sig", ticker: "SIG", status: "OPEN", pnlPct: -80.73 }),
    basePlay({ id: "fico", ticker: "FICO", status: "OPEN", pnlPct: 24.19 }),
  ];
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, "2026-09-10"));
  const buckets = legacyBoardCalendarBuckets(rows, ["2026-09-10"]);
  const today = buckets[0]!;
  assert.equal(today.net_premium_pct, Math.round(today.net_premium_pct), "must be a whole number");
  assert.equal(today.net_premium_pct, -28);
});

test("legacyBoardCalendarBuckets: closed count still includes the pull (tab-count parity, same as the scorecard fix)", () => {
  const plays = [basePlay({ id: "aso", ticker: "ASO", status: "SKIP", pnlPct: 306.67 })];
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, "2026-09-10"));
  const buckets = legacyBoardCalendarBuckets(rows, ["2026-09-10"]);
  assert.equal(buckets[0]?.closed, 1);
  assert.equal(buckets[0]?.net_premium_pct, 0, "no real resolution that day — never a fabricated positive tile");
});
