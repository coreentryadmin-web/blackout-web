import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorBoardTableRow } from "./vector-board-table-utils";
import {
  vectorBoardExportCsv,
  vectorBoardRowAtRisk,
  vectorBoardScorecard,
  vectorBoardSparklinePoints,
  vectorBoardTradeTicket,
} from "./vector-board-row-utils";

function row(partial: Partial<VectorBoardTableRow>): VectorBoardTableRow {
  return {
    key: "k1",
    kind: "live",
    status: "open",
    statusLabel: "Open",
    ticker: "NVDA",
    contractLabel: "180C",
    occ: "NVDA180C",
    sessionDate: "2026-09-01",
    rank: 1,
    tier: "elite",
    entryMid: 4.5,
    markMid: 5.0,
    premiumPct: 10,
    peakPct: 30,
    progressPct: 33,
    reason: "test",
    timestamp: new Date().toISOString(),
    setupInvalidated: false,
    ...partial,
  };
}

test("vectorBoardRowAtRisk flags caution and giveback", () => {
  assert.equal(vectorBoardRowAtRisk(row({ status: "caution" })), true);
  assert.equal(vectorBoardRowAtRisk(row({ premiumPct: 5, peakPct: 40 })), true);
  assert.equal(vectorBoardRowAtRisk(row({ premiumPct: 25, peakPct: 30 })), false);
});

test("vectorBoardScorecard computes hit rate and meters inputs", () => {
  const sc = vectorBoardScorecard([
    row({ status: "winner", premiumPct: 60 }),
    row({ status: "runner", premiumPct: 20, kind: "runner" }),
    row({ kind: "closed", status: "closed", premiumPct: -10 }),
  ]);
  assert.equal(sc.total, 3);
  assert.equal(sc.winners, 1);
  assert.ok(sc.netPremiumPct != null);
});

// ── Legacy's pre-open pull: a never-entered counterfactual must never read as an achieved
// result. Live evidence, 2026-09-10: a pulled ASO's +277.78% counterfactual outranked two
// genuinely open plays and was headlined "Best: ASO +277.78%" with "Hit rate 100%" driven
// entirely by that one withdrawn, never-tradeable play — no real position had resolved yet
// that session. legacy-board-table-utils.ts's legacyVectorStatus() is the only place in the
// codebase that stamps statusLabel "PULLED" (status: "invalidated", ticker never filled); Vector's
// OWN "invalidated" rows (a live position whose thesis broke mid-trade — setupInvalidated: true,
// statusLabel "Invalidated"/"Stressed") are a real result and must keep counting exactly as before.

test("vectorBoardScorecard: a PULLED (never-entered) row can never be bestPick, no matter its premiumPct", () => {
  const sc = vectorBoardScorecard([
    row({ ticker: "ASO", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 277.78 }),
    row({ ticker: "SIG", kind: "live", status: "open", premiumPct: -79 }),
    row({ ticker: "FICO", kind: "live", status: "open", premiumPct: 38 }),
  ]);
  assert.equal(sc.bestPick?.ticker, "FICO", "the pulled play's phantom +277.78% must lose to a real +38%");
});

test("vectorBoardScorecard: a PULLED row never counts toward Hit rate — no capital was ever live on it", () => {
  // Only a pulled play has "closed" today; nothing has really resolved yet.
  const sc = vectorBoardScorecard([
    row({ ticker: "ASO", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 277.78 }),
    row({ ticker: "SIG", kind: "live", status: "open", premiumPct: -79 }),
    row({ ticker: "FICO", kind: "live", status: "open", premiumPct: 38 }),
  ]);
  // Falls through to the live-status read (no real closes) rather than reading a fabricated
  // 100% off the one pulled row.
  assert.equal(sc.hitRate, 0, "no play has status:winner yet — never a phantom 100%");
  assert.equal(sc.closed, 1, "the Closed(1) tab elsewhere on the board still counts the pull");
});

test("vectorBoardScorecard: a real closed loser after a pull still grades honestly (denominator excludes the pull)", () => {
  const sc = vectorBoardScorecard([
    row({ ticker: "ASO", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 277.78 }),
    row({ ticker: "SIG", kind: "closed", status: "closed", premiumPct: -50 }),
  ]);
  assert.equal(sc.hitRate, 0, "1 real close, 0 real wins — the pull must not pad the denominator into a false 50%");
  assert.equal(sc.closed, 2);
});

test("vectorBoardScorecard: Vector's OWN invalidated (real position, thesis broke) is unaffected — still a real result", () => {
  const sc = vectorBoardScorecard([
    row({
      ticker: "NVDA",
      kind: "closed",
      status: "invalidated",
      statusLabel: "Invalidated",
      setupInvalidated: true,
      premiumPct: 65,
    }),
  ]);
  assert.equal(sc.bestPick?.ticker, "NVDA", "a real Vector position must still be eligible for bestPick");
  assert.equal(sc.hitRate, 100, "and must still count toward Hit rate — this was a real, resolved trade");
});

test("vectorBoardScorecard: a PULLED row's phantom return never dilutes Net premium either — same live evidence as bestPick/hitRate", () => {
  const sc = vectorBoardScorecard([
    row({ ticker: "ASO", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 306.67 }),
    row({ ticker: "SIG", kind: "live", status: "open", premiumPct: -82 }),
    row({ ticker: "FICO", kind: "live", status: "open", premiumPct: 29 }),
  ]);
  // Honest blended average over the two REAL rows: (-82 + 29) / 2 = -26.5, rounds to -27 or -26
  // depending on rounding direction — assert it's negative and nowhere near the phantom-inflated
  // +110% the live bug produced by including ASO's counterfactual.
  assert.ok(sc.netPremiumPct != null && sc.netPremiumPct < 0, `expected a negative honest average, got ${sc.netPremiumPct}`);
});

test("vectorBoardSparklinePoints returns entry-to-mark path", () => {
  const pts = vectorBoardSparklinePoints(row({ premiumPct: 20, peakPct: 40 }));
  assert.ok(pts.length >= 3);
  assert.equal(pts[0], 0);
});

test("vectorBoardTradeTicket and export csv", () => {
  const ticket = vectorBoardTradeTicket(row({}));
  assert.match(ticket, /NVDA/);
  const csv = vectorBoardExportCsv([row({})]);
  assert.match(csv, /Ticker/);
  assert.match(csv, /NVDA/);
});
