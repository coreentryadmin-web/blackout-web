import assert from "node:assert/strict";
import { test } from "node:test";
import type { VectorBoardTableRow } from "./vector-board-table-utils";
import {
  vectorBoardExportCsv,
  vectorBoardRowAtRisk,
  vectorBoardRowGivebackPct,
  vectorBoardScorecard,
  vectorBoardSparklinePoints,
  vectorBoardTimeline,
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

// ── vectorBoardRowGivebackPct must be a PERCENTAGE OF PEAK, not a raw point difference — same
// bug shape already fixed for Swing's "gave back X% from peak" bullets (mfe-capture.ts,
// FINDINGS 2026-09-10), missed by that fix's own blast-radius grep. A 20-point drop from a huge
// peak is mild; the identical 20-point drop from a small peak is severe — the old math reported
// both identically.
test("vectorBoardRowGivebackPct: proportional to peak, not a raw point subtraction", () => {
  // Peaked 200%, now 180% — a mild giveback relative to the huge peak: 10%, not 20.
  assert.equal(vectorBoardRowGivebackPct(row({ peakPct: 200, premiumPct: 180 })), 10);
  // Peaked 25%, now 5% — the SAME raw 20-point drop as above, but this is severe: 80%.
  assert.equal(vectorBoardRowGivebackPct(row({ peakPct: 25, premiumPct: 5 })), 80);
  // No giveback at all when still at peak.
  assert.equal(vectorBoardRowGivebackPct(row({ peakPct: 40, premiumPct: 40 })), 0);
  // A round-trip past breakeven into a loss clamps at 100%, never negative-capture nonsense.
  assert.equal(vectorBoardRowGivebackPct(row({ peakPct: 40, premiumPct: -15 })), 100);
  // No peak yet — nothing to compute a giveback against.
  assert.equal(vectorBoardRowGivebackPct(row({ peakPct: null, premiumPct: 10 })), null);
});

test("vectorBoardTimeline's 'Gave back' event also uses the proportional percentage", () => {
  const events = vectorBoardTimeline(row({ peakPct: 200, premiumPct: 180, kind: "live" }));
  const gaveBack = events.find((e) => e.label.startsWith("Gave back"));
  assert.ok(gaveBack, "the point-based gate (200-180=20) still fires the event");
  assert.equal(gaveBack?.label, "Gave back 10% from peak", "but the number must be proportional (10%), not the raw 20-point drop");
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

// ── Live production repro, 2026-09-11: a Legacy session where EVERY published play for the day
// got pulled pre-open (both AAPL and SWKS Cortex-vetoed by the morning-confirm cron). Distinct
// from the "1 pulled + 2 still-open real plays" case above, where the fallback denominator
// (rows.length) happens to read correctly because real, non-pulled rows dominate the population.
// Here there are ZERO non-pulled rows at all — the fallback's `rows.length`/`winners` read (2, 0)
// produces a literal "Hit rate 0%" on the live board, which reads as "today's picks lost" even
// though no capital was ever at risk and the pulled plays' own counterfactual read was strongly
// positive (+85%/+162% that same session). "0%" here is just as much a fabrication as the
// phantom-100% bug the tests above already guard against — the honest state is "no resolved
// data", i.e. null, not a computed rate over an entirely-phantom population.
test("vectorBoardScorecard: a day where EVERY play was pulled reads hitRate null, not a fabricated 0%", () => {
  const sc = vectorBoardScorecard([
    row({ ticker: "AAPL", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 85 }),
    row({ ticker: "SWKS", kind: "closed", status: "invalidated", statusLabel: "PULLED", premiumPct: 162 }),
  ]);
  assert.equal(sc.hitRate, null, "no real position ever resolved today — never read as a false 0%");
  assert.equal(sc.closed, 2, "the Closed(2) tab elsewhere on the board still counts both pulls");
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
