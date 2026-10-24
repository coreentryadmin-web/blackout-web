import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidateLeaderboard } from "./candidate-leaderboard";
import type { NighthawkCandidateSnapshotRow } from "@/lib/db";

let nextId = 1;
function row(overrides: Partial<NighthawkCandidateSnapshotRow>): NighthawkCandidateSnapshotRow {
  return {
    id: nextId++,
    edition_for: "2026-09-18",
    ticker: "NVDA",
    stage: "discovery",
    observed_at: "2026-09-18T02:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: {},
    forward_returns: null,
    ...overrides,
  };
}

test("buildCandidateLeaderboard: a ticker that reaches rank_final -- trajectory ordered by funnel depth, not raw observed_at", () => {
  // Deliberately out-of-array-order AND with observed_at timestamps that don't match funnel
  // order, to prove ordering comes from STAGE_ORDER, not insertion order or the clock.
  const rows = [
    row({ ticker: "NVDA", stage: "rank_final", rank: 1, score: 92, observed_at: "2026-09-18T02:00:01.000Z", selected_for_publish: true }),
    row({ ticker: "NVDA", stage: "discovery", rank: 5, score: 70, observed_at: "2026-09-18T02:00:04.000Z" }),
    row({ ticker: "NVDA", stage: "rank_governor", rank: 2, score: 92, observed_at: "2026-09-18T02:00:02.000Z" }),
    row({ ticker: "NVDA", stage: "scored", rank: 3, score: 88, observed_at: "2026-09-18T02:00:03.000Z" }),
  ];
  const [entry] = buildCandidateLeaderboard(rows);
  assert.equal(entry!.ticker, "NVDA");
  assert.deepEqual(entry!.trajectory.map((p) => p.stage), ["discovery", "scored", "rank_governor", "rank_final"]);
  assert.deepEqual(entry!.trajectory.map((p) => p.rank), [5, 3, 2, 1]);
});

test("buildCandidateLeaderboard: outcome is 'published' when any row has selected_for_publish true", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 1 }),
    row({ ticker: "NVDA", stage: "rank_final", rank: 1, selected_for_publish: true }),
  ]);
  assert.equal(entry!.outcome, "published");
});

test("buildCandidateLeaderboard: outcome is 'rejected' when a rejected row exists and none published", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "AMD", stage: "discovery", rank: 4 }),
    row({ ticker: "AMD", stage: "rejected", rank: 4, rejection_reason: "confluence_gate", selected_for_publish: false }),
  ]);
  assert.equal(entry!.outcome, "rejected");
});

test("buildCandidateLeaderboard: outcome is 'in_progress' when neither published nor rejected shows up (e.g. mid-funnel-only rows in a partial fetch)", () => {
  const [entry] = buildCandidateLeaderboard([row({ ticker: "TSLA", stage: "discovery", rank: 2 })]);
  assert.equal(entry!.outcome, "in_progress");
});

test("buildCandidateLeaderboard: rank_delta is first-ranked-stage minus last-ranked-stage, positive means it climbed", () => {
  // discovery rank 8 -> rank_final rank 1: climbed 7 spots -> delta +7.
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 8 }),
    row({ ticker: "NVDA", stage: "scored", rank: 4 }),
    row({ ticker: "NVDA", stage: "rank_final", rank: 1, selected_for_publish: true }),
  ]);
  assert.equal(entry!.rank_delta, 7);
});

test("buildCandidateLeaderboard: rank_delta is negative when a candidate fell (e.g. governor-demoted before being cut)", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "TSLA", stage: "discovery", rank: 2 }),
    row({ ticker: "TSLA", stage: "scored", rank: 3 }),
    row({ ticker: "TSLA", stage: "rejected", rank: 3, rejection_reason: "cross_edition_governor: loss_streak_halt" }),
  ]);
  assert.equal(entry!.rank_delta, -1);
});

test("buildCandidateLeaderboard: rank_delta is null when fewer than 2 ranked stages exist (a single, or entirely unranked, trajectory)", () => {
  const [single] = buildCandidateLeaderboard([row({ ticker: "AMD", stage: "discovery", rank: 6 })]);
  assert.equal(single!.rank_delta, null, "only one stage in the trajectory at all");

  const [unranked] = buildCandidateLeaderboard([
    row({ ticker: "ZZZ", stage: "discovery", rank: null }),
    row({ ticker: "ZZZ", stage: "rejected", rank: null, rejection_reason: "geometry" }),
  ]);
  assert.equal(unranked!.rank_delta, null, "no stage in the trajectory carries a non-null rank");
});

test("buildCandidateLeaderboard: an unrecognized stage sorts LAST, never crashes the ordering", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 1 }),
    row({ ticker: "NVDA", stage: "some_future_stage", rank: 1 }),
  ]);
  assert.deepEqual(entry!.trajectory.map((p) => p.stage), ["discovery", "some_future_stage"]);
});

test("buildCandidateLeaderboard: multiple tickers stay independently grouped, never cross-contaminated", () => {
  const entries = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 1 }),
    row({ ticker: "AMD", stage: "discovery", rank: 2 }),
    row({ ticker: "NVDA", stage: "rank_final", rank: 1, selected_for_publish: true }),
  ]);
  assert.equal(entries.length, 2);
  const nvda = entries.find((e) => e.ticker === "NVDA")!;
  const amd = entries.find((e) => e.ticker === "AMD")!;
  assert.equal(nvda.trajectory.length, 2);
  assert.equal(amd.trajectory.length, 1);
});

test("buildCandidateLeaderboard: an empty row list produces an empty leaderboard", () => {
  assert.deepEqual(buildCandidateLeaderboard([]), []);
});

// ── promotion_status (operator priority #10, WATCH->READY->TRIGGERED->ACTIVE/REJECTED) ──

test("buildCandidateLeaderboard: promotion_status ACTIVE for a published ticker, REJECTED for a rejected one", () => {
  const entries = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 1 }),
    row({ ticker: "NVDA", stage: "rank_final", rank: 1, selected_for_publish: true }),
    row({ ticker: "AMD", stage: "discovery", rank: 2 }),
    row({ ticker: "AMD", stage: "rejected", rank: 2, rejection_reason: "confluence_gate" }),
  ]);
  assert.equal(entries.find((e) => e.ticker === "NVDA")!.promotion_status, "ACTIVE");
  assert.equal(entries.find((e) => e.ticker === "AMD")!.promotion_status, "REJECTED");
});

test("buildCandidateLeaderboard: promotion_status WATCH when only discovery has been seen", () => {
  const [entry] = buildCandidateLeaderboard([row({ ticker: "TSLA", stage: "discovery", rank: 3 })]);
  assert.equal(entry!.promotion_status, "WATCH");
});

test("buildCandidateLeaderboard: promotion_status READY once scored is the deepest stage reached", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "TSLA", stage: "discovery", rank: 3 }),
    row({ ticker: "TSLA", stage: "scored", rank: 2 }),
  ]);
  assert.equal(entry!.promotion_status, "READY");
});

test("buildCandidateLeaderboard: promotion_status TRIGGERED once rank_governor is the deepest stage reached", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "TSLA", stage: "discovery", rank: 3 }),
    row({ ticker: "TSLA", stage: "scored", rank: 2 }),
    row({ ticker: "TSLA", stage: "rank_governor", rank: 2 }),
  ]);
  assert.equal(entry!.promotion_status, "TRIGGERED");
});

test("buildCandidateLeaderboard: an unrecognized deepest stage degrades to WATCH, never a guessed deeper status", () => {
  const [entry] = buildCandidateLeaderboard([
    row({ ticker: "NVDA", stage: "discovery", rank: 1 }),
    row({ ticker: "NVDA", stage: "some_future_stage", rank: 1 }),
  ]);
  assert.equal(entry!.promotion_status, "WATCH");
});
