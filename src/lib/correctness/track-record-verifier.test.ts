import { test, mock } from "node:test";
import assert from "node:assert/strict";

// track-record-verifier.ts imports "server-only" directly plus the whole served track-record
// graph (@/lib/db → pg, @/features/spx/lib/spx-play-outcomes, @/lib/track-record-public,
// @/lib/track-record-page). mock.module() needs the RELATIVE path from THIS file's own location
// for each (the tsx alias resolver does not run inside mock.module()'s specifier resolution under
// Node 20 — the same rule every sibling mock.module() test in this dir documents). @/lib/correctness/types
// is left REAL (pure roll-up helpers — the actual status math must run).

mock.module("server-only", { namedExports: {} });

type Row = { outcome: string; opened_at?: string };

const state = {
  closedRows: [] as Row[],
  stats: null as unknown,
  pub: null as unknown,
};

function resetState() {
  state.closedRows = [];
  state.stats = null;
  state.pub = null;
}

// fetchClosedPlayOutcomes returns EVERY non-open row — including 'superseded' (its SQL is
// `WHERE outcome <> 'open'`), which is exactly why the JS-side "closed" filter must drop them.
mock.module("../db", {
  namedExports: {
    fetchClosedPlayOutcomes: async () => state.closedRows,
    fetchPlayLifecycleCounts: async () => ({ open_play_outcomes: 0, ever_opened_outcomes: 0, open_plays: 0 }),
  },
});

mock.module("../../features/spx/lib/spx-play-outcomes", {
  namedExports: {
    fetchPlayOutcomeStats: async () => state.stats,
    readPlayWriteFailures: async () => ({ count: 0, last_at: null, last_message: null }),
  },
});

mock.module("../track-record-public", {
  namedExports: {
    buildPublicTrackRecord: async () => state.pub,
  },
});

// The /track-record page cross-surface layer isn't what this suite is about — stub a matching
// page so pageSpxMatchesPublic short-circuits to "match" and never contributes a flag of its own.
mock.module("../track-record-page", {
  namedExports: {
    buildTrackRecordPagePayload: async () => ({ spxSlayer: { wins: 2, losses: 1, total: 3 } }),
    pageSpxMatchesPublic: () => true,
  },
});

const mod = () => import("./track-record-verifier");

/** Every check the verifier emitted, flattened across metrics. */
function allChecks(score: { metrics: Array<{ checks: Array<{ outcome: string; detail: string }> }> }) {
  return score.metrics.flatMap((m) => m.checks);
}

// Fix 6: 'superseded' rows (stale opens force-closed as bookkeeping) are NOT real closed
// outcomes — the served path (computePlayOutcomeStats: outcome !== 'open' && !== 'superseded')
// excludes them. The verifier used to keep them in `closedRows`, inflating myClosed, so the L2
// partition (wins+losses+scratch == closed) and the L1 recompute-vs-served both FLAGGED a
// perfectly healthy ledger whenever any superseded rows existed. After the fix, the recompute
// matches the served counts and there is NO flag.
test("Fix 6: superseded rows are excluded from the recompute — a healthy ledger with superseded rows does NOT flag", async () => {
  resetState();
  // 2W / 1L / 1 breakeven that ACTUALLY closed, plus 3 superseded bookkeeping rows.
  state.closedRows = [
    { outcome: "win" },
    { outcome: "win" },
    { outcome: "loss" },
    { outcome: "breakeven" },
    { outcome: "superseded" },
    { outcome: "superseded" },
    { outcome: "superseded" },
  ];
  // The SERVED paths already exclude superseded → 4 closed, 50% WR.
  state.stats = { overall: { wins: 2, losses: 1, breakeven: 1, win_rate: 0.5 }, total_closed: 4 };
  state.pub = { available: true, wins: 2, losses: 1, breakeven: 1, total_closed: 4, win_rate_pct: 50 };

  const { verifyTrackRecord } = await mod();
  const score = await verifyTrackRecord(false);

  const flags = allChecks(score).filter((c) => c.outcome === "flag");
  assert.deepEqual(
    flags.map((f) => f.detail),
    [],
    "no check may flag — the recompute (superseded excluded) must equal the served counts"
  );
  assert.notEqual(score.status, "flag");
});

// Guard the other direction: a GENUINE mismatch (the served path really disagrees with the raw
// ledger) must still FLAG — the fix narrowed the "closed" set, it did not mute the check.
test("Fix 6: a real recompute-vs-served disagreement still flags (the check is not muted)", async () => {
  resetState();
  state.closedRows = [
    { outcome: "win" },
    { outcome: "win" },
    { outcome: "loss" },
    { outcome: "superseded" },
  ];
  // Served path claims 3W/0L over 3 — a real split-brain vs the ledger's 2W/1L.
  state.stats = { overall: { wins: 3, losses: 0, breakeven: 0, win_rate: 1 }, total_closed: 3 };
  state.pub = { available: true, wins: 3, losses: 0, breakeven: 0, total_closed: 3, win_rate_pct: 100 };

  const { verifyTrackRecord } = await mod();
  const score = await verifyTrackRecord(false);
  const flags = allChecks(score).filter((c) => c.outcome === "flag");
  assert.ok(flags.length > 0, "a genuine served-vs-ledger disagreement must still flag");
});
