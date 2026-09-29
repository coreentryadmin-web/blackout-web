import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ScoredCandidate } from "./scorer";
import type { MultiSourceCandidateRow } from "./candidates";

// Real behavioral coverage (2026-09-20 audit follow-up) for the three candidate-snapshot write
// call sites that live in their own named, exported functions: does a genuine
// insertNighthawkCandidateSnapshots() REJECTION actually (a) get swallowed -- the caller never
// sees it and nothing throws -- and (b) actually trigger alertCandidateSnapshotWriteFailure with
// the right stage/edition? The sibling wiring test (candidate-snapshot-alert-wiring.test.ts)
// proves the source calls the right function by name; this proves the runtime behavior when the
// write genuinely fails.
//
// edition-builder.ts's import graph pulls in `server-only` (via ./dossier -> gex-positioning.ts),
// which throws outside Next's react-server webpack condition -- stub it exactly like
// edition-builder-scoring-history.test.ts and every run-tool.test.ts sibling does.
mock.module("server-only", { namedExports: {} });

const state = {
  insertedRows: [] as unknown[][],
  shouldReject: false,
  rejectError: new Error("write failed"),
  alerts: [] as Array<{ stage: string; editionFor: string; err: unknown }>,
};

function resetState() {
  state.insertedRows = [];
  state.shouldReject = false;
  state.rejectError = new Error("write failed");
  state.alerts = [];
}

before(async () => {
  const realDb = await import("../../../lib/db");
  mock.module("../../../lib/db", {
    namedExports: {
      ...realDb,
      insertNighthawkCandidateSnapshots: async (rows: unknown[]) => {
        state.insertedRows.push(rows);
        if (state.shouldReject) throw state.rejectError;
      },
    },
  });
  mock.module("./candidate-snapshot-alert", {
    namedExports: {
      alertCandidateSnapshotWriteFailure: (stage: string, editionFor: string, err: unknown) => {
        state.alerts.push({ stage, editionFor, err });
      },
    },
  });
});

beforeEach(resetState);

async function loadCandidates() {
  return import("./candidates");
}
async function loadEditionBuilder() {
  return import("./edition-builder");
}

function fakeScoredCandidate(ticker: string): ScoredCandidate {
  return {
    ticker,
    score: 42,
    direction: "long",
  } as unknown as ScoredCandidate;
}

test("recordDiscoveryStageSnapshots: a write failure is fully swallowed (never throws, never rejects) and alerts with stage=discovery", async () => {
  const { recordDiscoveryStageSnapshots } = await loadCandidates();
  state.shouldReject = true;

  const rows: MultiSourceCandidateRow[] = [
    { ticker: "AAPL", composite_score: 10, source_count: 1, sources: ["flow"], lane_scores: { flow: 10 } },
  ];
  assert.doesNotThrow(() => {
    recordDiscoveryStageSnapshots("2026-09-22", rows, rows, new Map(), null);
  });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.insertedRows.length, 1, "the write was still attempted");
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0]!.stage, "discovery");
  assert.equal(state.alerts[0]!.editionFor, "2026-09-22");
  assert.equal(state.alerts[0]!.err, state.rejectError);
});

test("recordDiscoveryStageSnapshots: a SUCCESSFUL write never alerts", async () => {
  const { recordDiscoveryStageSnapshots } = await loadCandidates();
  state.shouldReject = false;

  const rows: MultiSourceCandidateRow[] = [
    { ticker: "MSFT", composite_score: 5, source_count: 1, sources: ["flow"], lane_scores: { flow: 5 } },
  ];
  recordDiscoveryStageSnapshots("2026-09-22", rows, rows, new Map(), null);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.insertedRows.length, 1);
  assert.equal(state.alerts.length, 0);
});

test("recordScoringStageSnapshots: a write failure alerts with the REAL stage passed in (rank_governor), not a hardcoded one", async () => {
  const { recordScoringStageSnapshots } = await loadEditionBuilder();
  state.shouldReject = true;

  recordScoringStageSnapshots("2026-09-22", "rank_governor", [fakeScoredCandidate("NVDA")]);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0]!.stage, "rank_governor");
  assert.equal(state.alerts[0]!.editionFor, "2026-09-22");
});

test("recordScoringStageSnapshots: 'scored' stage alerts as 'scored'", async () => {
  const { recordScoringStageSnapshots } = await loadEditionBuilder();
  state.shouldReject = true;

  recordScoringStageSnapshots("2026-09-23", "scored", [fakeScoredCandidate("TSLA")]);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0]!.stage, "scored");
});

test("recordStageRejectionSnapshots: a write failure alerts with stage=rejected", async () => {
  const { recordStageRejectionSnapshots } = await loadEditionBuilder();
  state.shouldReject = true;

  recordStageRejectionSnapshots("2026-09-22", [
    { ticker: "GME", detail: { stage: "confluence_gate", reasons: ["thin"] } as never },
  ]);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0]!.stage, "rejected");
  assert.equal(state.alerts[0]!.editionFor, "2026-09-22");
});

test("recordStageRejectionSnapshots: an empty rejected list never writes or alerts", async () => {
  const { recordStageRejectionSnapshots } = await loadEditionBuilder();
  state.shouldReject = true;

  recordStageRejectionSnapshots("2026-09-22", []);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.insertedRows.length, 0);
  assert.equal(state.alerts.length, 0);
});
