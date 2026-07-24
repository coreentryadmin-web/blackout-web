import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshestCatalystAgeDays,
  parseEarningsWindows,
  deriveCatalystReads,
  contractQualityFromIvRank,
  isCatalystNewsItem,
  SWING_CATALYST_WINDOW_DAYS,
  POST_EARNINGS_DRIFT_WINDOW_DAYS,
  type SwingEarningsWindows,
} from "./swing-catalyst.ts";

const NOW = Date.parse("2026-07-24T21:00:00.000Z");
const daysAgoIso = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ymdDaysFromNow = (d: number) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10);

// ── freshestCatalystAgeDays ──────────────────────────────────────────────────────

test("isCatalystNewsItem: only real catalyst channels count", () => {
  assert.equal(isCatalystNewsItem({ channels: ["fda"], publishedAt: "" }), true);
  assert.equal(isCatalystNewsItem({ channels: ["M&A", " Guidance "], publishedAt: "" }), true, "case/space tolerant");
  assert.equal(isCatalystNewsItem({ channels: ["general", "press releases"], publishedAt: "" }), false);
  assert.equal(isCatalystNewsItem({ channels: [], publishedAt: "" }), false);
});

test("freshestCatalystAgeDays: freshest in-window catalyst; non-catalyst/stale/future excluded", () => {
  const items = [
    { channels: ["general"], publishedAt: daysAgoIso(0.1) }, // not a catalyst channel
    { channels: ["fda"], publishedAt: daysAgoIso(3) }, // catalyst, in window
    { channels: ["guidance"], publishedAt: daysAgoIso(1) }, // catalyst, FRESHER
    { channels: ["m&a"], publishedAt: daysAgoIso(30) }, // catalyst but stale (> window)
  ];
  const age = freshestCatalystAgeDays(items, NOW);
  assert.ok(age != null && Math.abs(age - 1) < 1e-6, "freshest catalyst is the 1-day-old guidance headline");

  assert.equal(freshestCatalystAgeDays([], NOW), null, "no items → null");
  assert.equal(freshestCatalystAgeDays([{ channels: ["fda"], publishedAt: "not-a-date" }], NOW), null, "unparseable ts → null");
  assert.equal(
    freshestCatalystAgeDays([{ channels: ["fda"], publishedAt: daysAgoIso(-2) }], NOW),
    null,
    "a future-dated headline is not a past catalyst",
  );
  assert.equal(
    freshestCatalystAgeDays([{ channels: ["fda"], publishedAt: daysAgoIso(SWING_CATALYST_WINDOW_DAYS + 1) }], NOW),
    null,
    "beyond the swing catalyst window → null",
  );
});

// ── parseEarningsWindows ──────────────────────────────────────────────────────────

test("parseEarningsWindows: splits the feed into the next (future) and last (past) prints", () => {
  const rows = [
    { earnings_date: ymdDaysFromNow(9), is_confirmed: true }, // upcoming, in ~9d
    { earnings_date: ymdDaysFromNow(40) }, // further-out future (ignored — not the soonest)
    { report_date: ymdDaysFromNow(-5), street_mean_est: 1.0, actual_eps: 1.2 }, // last report, 5d ago, +20% surprise
    { report_date: ymdDaysFromNow(-95) }, // older past (ignored — not the most recent)
  ];
  const w = parseEarningsWindows(rows, NOW);
  assert.equal(w.nextEarnings?.daysUntil, 9);
  assert.equal(w.nextEarnings?.isConfirmed, true);
  assert.equal(w.lastEarnings?.daysAgo, 5);
  assert.ok(w.lastEarnings?.surprisePct != null && Math.abs(w.lastEarnings.surprisePct - 20) < 1e-6, "surprise derived from actual vs estimate");

  const none = parseEarningsWindows([], NOW);
  assert.deepEqual(none, { nextEarnings: null, lastEarnings: null });
});

test("parseEarningsWindows: a today-dated row is 'next' (daysUntil 0), a direct surprise_pct is used as-is", () => {
  const w = parseEarningsWindows(
    [{ earnings_date: ymdDaysFromNow(0) }, { report_date: ymdDaysFromNow(-2), surprise_pct: -8 }],
    NOW,
  );
  assert.equal(w.nextEarnings?.daysUntil, 0);
  assert.equal(w.lastEarnings?.surprisePct, -8);
});

// ── deriveCatalystReads ────────────────────────────────────────────────────────────

const NO_EARNINGS: SwingEarningsWindows = { nextEarnings: null, lastEarnings: null };

test("deriveCatalystReads: a fresh Benzinga catalyst grounds catalystStrength01 + catalystInWindow01 (EVENT_DRIVEN)", () => {
  const r = deriveCatalystReads({
    intendedDte: 14,
    signedReturnPct10d: 5,
    freshCatalystAgeDays: 0, // a same-day catalyst → max recency
    earnings: NO_EARNINGS,
  });
  assert.ok((r.catalystStrength01 ?? 0) > 0.9, "a same-day catalyst is a strong catalyst read");
  assert.equal(r.catalystInWindow01, r.catalystStrength01, "the EVENT_DRIVEN fit input mirrors the raw strength");
  assert.equal(r.earningsInWindow, false, "no earnings → no hazard");
});

test("deriveCatalystReads: earnings inside the holding window sets the hazard AND grounds pre-earnings strength", () => {
  const r = deriveCatalystReads({
    intendedDte: 14,
    signedReturnPct10d: 0,
    freshCatalystAgeDays: null, // no news
    earnings: { nextEarnings: { daysUntil: 3, isConfirmed: true }, lastEarnings: null },
  });
  assert.equal(r.earningsInWindow, true, "earnings in 3d ≤ 14 DTE → binary-gap hazard flagged");
  assert.ok((r.catalystStrength01 ?? 0) > 0, "an imminent known print is a pre-earnings catalyst");
  assert.equal(r.catalystInWindow01, r.catalystStrength01);
});

test("deriveCatalystReads: earnings BEYOND the window are not in-window; unconfirmed dates are softer", () => {
  const beyond = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: 0, freshCatalystAgeDays: null,
    earnings: { nextEarnings: { daysUntil: 20, isConfirmed: true }, lastEarnings: null },
  });
  assert.equal(beyond.earningsInWindow, false, "20d > 14 DTE → not in the holding window");
  assert.equal(beyond.catalystStrength01, null, "no catalyst in window → null (never a fabricated 0)");

  const confirmed = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: 0, freshCatalystAgeDays: null,
    earnings: { nextEarnings: { daysUntil: 3, isConfirmed: true }, lastEarnings: null },
  });
  const unconfirmed = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: 0, freshCatalystAgeDays: null,
    earnings: { nextEarnings: { daysUntil: 3, isConfirmed: false }, lastEarnings: null },
  });
  assert.ok(
    (unconfirmed.catalystStrength01 ?? 0) < (confirmed.catalystStrength01 ?? 0),
    "an unconfirmed earnings date is softer evidence than a confirmed one",
  );
});

test("deriveCatalystReads: a recent earnings gap grounds the POST_EARNINGS_DRIFT extras; stale prints don't", () => {
  const recent = deriveCatalystReads({
    intendedDte: 14,
    signedReturnPct10d: 9, // strong aligned continuation since the print
    freshCatalystAgeDays: null,
    earnings: { nextEarnings: null, lastEarnings: { daysAgo: 3, surprisePct: 12 } },
  });
  assert.ok((recent.earningsGapRecent01 ?? 0) > 0, "a recent, large-surprise print grounds earningsGapRecent01");
  assert.ok((recent.postEarningsDrift01 ?? 0) > 0, "aligned drift since the print grounds postEarningsDrift01");

  const stale = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: 9, freshCatalystAgeDays: null,
    earnings: { nextEarnings: null, lastEarnings: { daysAgo: POST_EARNINGS_DRIFT_WINDOW_DAYS + 5, surprisePct: 12 } },
  });
  assert.equal(stale.earningsGapRecent01, null, "a print beyond the drift window grounds nothing (honest absence)");
  assert.equal(stale.postEarningsDrift01, null);
});

test("deriveCatalystReads: post-earnings drift is DIRECTION-ALIGNED (a signed down-move is positive for a SHORT)", () => {
  // signedReturnPct10d is already direction-signed upstream — a SHORT whose name fell reads as positive drift.
  const shortDrift = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: 8, freshCatalystAgeDays: null,
    earnings: { nextEarnings: null, lastEarnings: { daysAgo: 2, surprisePct: null } },
  });
  assert.ok((shortDrift.postEarningsDrift01 ?? 0) > 0, "a positive signed return is aligned drift regardless of side");
  // A move AGAINST the trade (negative signed return) is not positive drift.
  const against = deriveCatalystReads({
    intendedDte: 14, signedReturnPct10d: -8, freshCatalystAgeDays: null,
    earnings: { nextEarnings: null, lastEarnings: { daysAgo: 2, surprisePct: null } },
  });
  assert.equal(against.postEarningsDrift01, 0, "a counter-trend move clamps drift to 0 (no aligned continuation)");
});

test("deriveCatalystReads: nothing grounded → all-null/false (no fabricated 0)", () => {
  const r = deriveCatalystReads({ intendedDte: 14, signedReturnPct10d: null, freshCatalystAgeDays: null, earnings: NO_EARNINGS });
  assert.equal(r.catalystStrength01, null);
  assert.equal(r.catalystInWindow01, null);
  assert.equal(r.earningsInWindow, false);
  assert.equal(r.earningsGapRecent01, null);
  assert.equal(r.postEarningsDrift01, null);
});

// ── contractQualityFromIvRank ──────────────────────────────────────────────────────

test("contractQualityFromIvRank: inverse to IV rank (cheap premium = high quality); null when absent", () => {
  assert.equal(contractQualityFromIvRank(0), 1, "IV rank 0 → cheapest premium → top contract quality");
  assert.equal(contractQualityFromIvRank(100), 0, "IV rank 100 → richest premium → lowest quality");
  assert.equal(contractQualityFromIvRank(25), 0.75, "a 0–100 rank normalizes (25 → 0.75 quality)");
  assert.equal(contractQualityFromIvRank(0.25), 0.75, "an already-0–1 fraction is tolerated (0.25 → 0.75)");
  assert.equal(contractQualityFromIvRank(null), null, "no rank → null (pillar drops, never a fabricated 0)");
  assert.equal(contractQualityFromIvRank(undefined), null);
  assert.equal(contractQualityFromIvRank(Number.NaN), null);
});
