import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NighthawkCandidateSnapshotRow } from "@/lib/db";

// post-publish-backfill.ts's import chain reaches "server-only" transitively via
// edition-builder.ts -> dossier.ts -> gex-positioning.ts, same boundary
// edition-builder-scoring-snapshot.test.ts already stubs. Only the pure
// reconstructScoredPoolFromRankGovernorRows function is unit-tested here — the async
// republishBackfilledEdition orchestrator calls real @/lib/db functions unconditionally and
// this repo's test environment cannot safely mock "@/lib/db" (see this file's own precedent's
// comment: once ANY mock.module() targets an aliased-elsewhere specifier, tsx stops resolving
// the "@/" alias across the whole loaded graph) — its guard logic is simple enough (two early
// returns + a minPlays comparison) to review directly against the composed, already-tested
// pure functions it calls (selectBackfillPlays: 8 tests, computeQualityFloorNote: 7 tests,
// buildRankFinalSnapshotRows: covered in edition-builder-scoring-snapshot.test.ts).
import { mock } from "node:test";
mock.module("server-only", { namedExports: {} });

function snapshotRow(overrides: Partial<NighthawkCandidateSnapshotRow>): NighthawkCandidateSnapshotRow {
  return {
    id: 1,
    edition_for: "2026-09-29",
    ticker: "TEST",
    stage: "rank_governor",
    observed_at: "2026-09-28T21:40:00Z",
    rank: null,
    score: 30,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: { score: 30, direction: "long", conviction: "C" },
    ...overrides,
  };
}

test("reconstructScoredPoolFromRankGovernorRows: rebuilds direction/score/conviction from snapshot_json verbatim", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [
    snapshotRow({
      ticker: "BB",
      score: 41,
      gov_penalty: 10,
      snapshot_json: {
        score: 41,
        direction: "long",
        conviction: "B",
        gov_penalty: 10,
        confirming_signals: 3,
        components: { flow_score: 20, tech_score: 10, pos_score: 5, news_score: 3, smart_money_score: 3 },
      },
    }),
  ];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  assert.equal(pool.length, 1);
  assert.equal(pool[0]!.ticker, "BB");
  assert.equal(pool[0]!.score, 41);
  assert.equal(pool[0]!.direction, "long");
  assert.equal(pool[0]!.conviction, "B");
  assert.equal(pool[0]!.govPenalty, 10);
  assert.equal(pool[0]!.flow_score, 20);
});

test("reconstructScoredPoolFromRankGovernorRows: short direction preserved (never defaults away a real short)", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [snapshotRow({ ticker: "SHRT", snapshot_json: { score: 33, direction: "short", conviction: "B" } })];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  assert.equal(pool[0]!.direction, "short");
});

test("reconstructScoredPoolFromRankGovernorRows: filters out rows from any other stage", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [
    snapshotRow({ ticker: "GOV", stage: "rank_governor" }),
    snapshotRow({ ticker: "SCORED_ONLY", stage: "scored" }),
    snapshotRow({ ticker: "REJECTED", stage: "rejected" }),
  ];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  assert.deepEqual(
    pool.map((c) => c.ticker),
    ["GOV"]
  );
});

test("reconstructScoredPoolFromRankGovernorRows: missing gov_penalty in snapshot_json falls back to the row column, then undefined", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [
    snapshotRow({ ticker: "FROM_COLUMN", gov_penalty: 5, snapshot_json: { score: 30, direction: "long", conviction: "C" } }),
    snapshotRow({ ticker: "NO_PENALTY", gov_penalty: null, snapshot_json: { score: 30, direction: "long", conviction: "C" } }),
  ];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  const fromColumn = pool.find((c) => c.ticker === "FROM_COLUMN");
  const noPenalty = pool.find((c) => c.ticker === "NO_PENALTY");
  assert.equal(fromColumn!.govPenalty, 5);
  assert.equal(noPenalty!.govPenalty, undefined);
});

test("reconstructScoredPoolFromRankGovernorRows: missing/malformed components never fabricate — default to 0, never crash", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [snapshotRow({ ticker: "NO_COMPONENTS", snapshot_json: { score: 30, direction: "long", conviction: "C" } })];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  assert.equal(pool[0]!.flow_score, 0);
  assert.equal(pool[0]!.tech_score, 0);
  assert.equal(pool[0]!.pos_score, 0);
  assert.equal(pool[0]!.news_score, 0);
  assert.equal(pool[0]!.smart_money_score, 0);
});

test("reconstructScoredPoolFromRankGovernorRows: missing conviction in payload defaults to the conservative tier C, never fabricates B/A", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [snapshotRow({ ticker: "NO_CONVICTION", snapshot_json: { score: 30, direction: "long" } })];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  assert.equal(pool[0]!.conviction, "C");
});

test("reconstructScoredPoolFromRankGovernorRows: real multi-ticker pool round-trips exactly (regression fixture from the 2026-09-29 live dry run)", async () => {
  const { reconstructScoredPoolFromRankGovernorRows } = await import("./post-publish-backfill");
  const rows = [
    snapshotRow({ ticker: "WAT", score: 32, snapshot_json: { score: 32, direction: "long", conviction: "C" } }),
    snapshotRow({
      ticker: "TWLO",
      score: 29,
      gov_penalty: 10,
      snapshot_json: { score: 29, direction: "long", conviction: "C", gov_penalty: 10 },
    }),
    snapshotRow({ ticker: "ZS", score: 25, snapshot_json: { score: 25, direction: "long", conviction: "C" } }),
  ];
  const pool = reconstructScoredPoolFromRankGovernorRows(rows);
  const effective = (t: string) => {
    const c = pool.find((x) => x.ticker === t)!;
    return c.score - (c.govPenalty ?? 0);
  };
  // Same order the live dry run's selection walked: WAT(32) > TWLO(19 effective) > ZS(25) sorts as WAT, ZS, TWLO.
  const sorted = [...pool].sort((a, b) => a.score - (a.govPenalty ?? 0) - (b.score - (b.govPenalty ?? 0))).reverse();
  assert.deepEqual(
    sorted.map((c) => c.ticker),
    ["WAT", "ZS", "TWLO"]
  );
  assert.equal(effective("TWLO"), 19);
});

// Source-inspection regression guard (2026-09-29, live split-brain found by
// legacy-e2e-healthcheck.mjs's stage D): republishBackfilledEdition must call
// syncNighthawkPlayOutcomes the same way every other Legacy publish path (edition-builder.ts)
// does, or a BACKFILL play gets no nighthawk_play_outcomes row at all -- the 9:15am ET
// morning-confirm cron's pull latch then silently no-ops for it (no row to match), so an
// INVALIDATED backfilled play never gets pulled=true and the member-facing edition keeps
// showing it as live/actionable. Live-reproduced 2026-09-29: BB (added via republish) showed
// play-status=INVALIDATED but edition pulled=false, while AMD (an original QUALIFIED play with
// a real outcome row from the normal publish path) correctly flipped pulled=true for the same
// verdict. republishBackfilledEdition's own async orchestrator can't be behaviorally unit-tested
// here (see this file's header comment -- @/lib/db can't be safely mocked in this test
// environment without breaking the "@/" alias across the whole loaded graph), so this is the
// cheap, precise substitute: it fails the instant the sync call site is removed or is no longer
// awaited/still reachable.
function readSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

test("post-publish-backfill.ts: republishBackfilledEdition syncs outcome rows for the full final play list, not just the backfilled ones", () => {
  const src = readSource("./post-publish-backfill.ts");
  assert.match(src, /import \{ syncNighthawkPlayOutcomes \} from "\.\/play-outcomes";/);
  const callIdx = src.indexOf("await syncNighthawkPlayOutcomes(");
  assert.ok(callIdx >= 0, "syncNighthawkPlayOutcomes must be called (and awaited) from republishBackfilledEdition");
  const call = src.slice(callIdx, callIdx + 200);
  // Must sync the FULL final list (result.plays: original QUALIFIED + new BACKFILL plays), never
  // just the newly-added tickers -- pruneNighthawkPlayOutcomesForEdition (called inside
  // syncNighthawkPlayOutcomes) deletes any still-pending row for a ticker NOT in the passed list,
  // so passing only the backfilled subset would silently delete the original play's own row.
  assert.match(call, /syncNighthawkPlayOutcomes\(editionFor, result\.plays, sectorByTicker, \{\}\)/);
  // Must be inside its own try/catch, matching edition-builder.ts's "POST-PUBLISH steps isolated
  // from the outer catch" discipline -- a transient DB failure here must not fail the whole
  // republish response, since the edition row is already written and members are already served.
  const nearestTryIdx = src.lastIndexOf("try {", callIdx);
  const nearestCatchAfterCall = src.indexOf("} catch", callIdx);
  assert.ok(nearestTryIdx >= 0 && nearestTryIdx < callIdx, "the sync call must be preceded by its own try block");
  assert.ok(
    nearestCatchAfterCall >= 0 && nearestCatchAfterCall < callIdx + 300,
    "the sync call's try block must be followed closely by a catch (not left to throw into the caller)"
  );
});
