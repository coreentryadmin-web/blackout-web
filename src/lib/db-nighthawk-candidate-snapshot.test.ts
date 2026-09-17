import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapNighthawkCandidateSnapshotRow } from "./db";

// nighthawk_candidate_snapshot (Night Hawk Legacy Signal Intelligence, Phase 1 foundation) is
// schema-only and Postgres is NOT exercised in CI (same constraint as db.test.ts /
// db-swing-ledger.test.ts). So the unit tests here cover the PURE, exported row mapper (NUMERIC-
// string -> number, null-stays-null, JSONB already-parsed) plus source-inspection assertions that
// the writer SQL is fully parameterized (no raw string interpolation of caller values) and that
// the table itself is genuinely append-only (no ON CONFLICT / upsert, unlike
// nighthawk_scoring_history's upsert-by-key design) -- the one structural property this whole
// table's purpose depends on: every pipeline stage gets its own durable row.

// ─── mapNighthawkCandidateSnapshotRow ──────────────────────────────────────────────────────

test("mapNighthawkCandidateSnapshotRow: NUMERIC columns arriving as strings (node-pg) become real numbers", () => {
  const row = mapNighthawkCandidateSnapshotRow({
    id: "42",
    edition_for: "2026-09-17",
    ticker: "nvda",
    stage: "scored",
    observed_at: "2026-09-17T21:35:00.000Z",
    rank: "3",
    score: "71.5",
    gov_penalty: "0",
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: { schema_version: 1, foo: "bar" },
  });
  assert.equal(row.id, 42);
  assert.equal(typeof row.id, "number");
  assert.equal(row.rank, 3);
  assert.equal(typeof row.rank, "number");
  assert.equal(row.score, 71.5);
  assert.equal(row.gov_penalty, 0);
  assert.equal(typeof row.gov_penalty, "number");
});

test("mapNighthawkCandidateSnapshotRow: ticker is upper-cased regardless of how it arrived", () => {
  const row = mapNighthawkCandidateSnapshotRow({
    id: "1",
    edition_for: "2026-09-17",
    ticker: "nvda",
    stage: "discovery",
    observed_at: "2026-09-17T21:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: {},
  });
  assert.equal(row.ticker, "NVDA");
});

test("mapNighthawkCandidateSnapshotRow: nullable columns stay null, never coerced to 0/false/empty-string", () => {
  const row = mapNighthawkCandidateSnapshotRow({
    id: "1",
    edition_for: "2026-09-17",
    ticker: "AMD",
    stage: "discovery",
    observed_at: "2026-09-17T21:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: {},
  });
  assert.equal(row.rank, null);
  assert.equal(row.score, null);
  assert.equal(row.gov_penalty, null);
  assert.equal(row.rejection_reason, null);
  assert.equal(row.selected_for_publish, null);
});

test("mapNighthawkCandidateSnapshotRow: rejection_reason and selected_for_publish are read verbatim at terminal stages", () => {
  const rejected = mapNighthawkCandidateSnapshotRow({
    id: "9",
    edition_for: "2026-09-17",
    ticker: "AXTI",
    stage: "rejected",
    observed_at: "2026-09-17T21:40:00.000Z",
    rank: null,
    score: "44.2",
    gov_penalty: null,
    rejection_reason: "target_unreachable",
    selected_for_publish: false,
    snapshot_json: {},
  });
  assert.equal(rejected.rejection_reason, "target_unreachable");
  assert.equal(rejected.selected_for_publish, false);

  const published = mapNighthawkCandidateSnapshotRow({
    id: "10",
    edition_for: "2026-09-17",
    ticker: "NVDA",
    stage: "published",
    observed_at: "2026-09-17T21:41:00.000Z",
    rank: "1",
    score: "88.1",
    gov_penalty: "0",
    rejection_reason: null,
    selected_for_publish: true,
    snapshot_json: {},
  });
  assert.equal(published.rejection_reason, null);
  assert.equal(published.selected_for_publish, true);
});

test("mapNighthawkCandidateSnapshotRow: snapshot_json is passed through as an already-parsed object, not re-JSON.parsed", () => {
  const payload = { schema_version: 1, discovery: { raw_flow_premium: 1_250_000 } };
  const row = mapNighthawkCandidateSnapshotRow({
    id: "1",
    edition_for: "2026-09-17",
    ticker: "NVDA",
    stage: "discovery",
    observed_at: "2026-09-17T21:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: payload,
  });
  assert.deepEqual(row.snapshot_json, payload);
});

test("mapNighthawkCandidateSnapshotRow: snapshot_json defaults to {} rather than null/undefined", () => {
  const row = mapNighthawkCandidateSnapshotRow({
    id: "1",
    edition_for: "2026-09-17",
    ticker: "NVDA",
    stage: "discovery",
    observed_at: "2026-09-17T21:00:00.000Z",
    rank: null,
    score: null,
    gov_penalty: null,
    rejection_reason: null,
    selected_for_publish: null,
    snapshot_json: null as unknown as Record<string, unknown>,
  });
  assert.deepEqual(row.snapshot_json, {});
});

// ─── Source-inspection: table shape + parameterization ─────────────────────────────────────

function readDbSource(): string {
  return readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
}

test("nighthawk_candidate_snapshot: table is genuinely append-only, no ON CONFLICT / upsert", () => {
  const src = readDbSource();
  const tableStart = src.indexOf("CREATE TABLE IF NOT EXISTS nighthawk_candidate_snapshot");
  assert.ok(tableStart > 0, "nighthawk_candidate_snapshot table definition not found");
  const tableEnd = src.indexOf(");", tableStart);
  const tableDdl = src.slice(tableStart, tableEnd);

  // No UNIQUE constraint on (edition_for, ticker) -- that's nighthawk_scoring_history's own
  // upsert-by-key design (see its own table def just above this one), deliberately NOT this
  // table's design: every pipeline stage must get its own row, never overwrite a prior stage's.
  assert.doesNotMatch(tableDdl, /UNIQUE/i, "must not carry a UNIQUE constraint — every stage needs its own row");

  const insertOneStart = src.indexOf("export async function insertNighthawkCandidateSnapshot(row");
  assert.ok(insertOneStart > 0, "insertNighthawkCandidateSnapshot not found");
  const insertOneEnd = src.indexOf("\n}\n", insertOneStart);
  const insertOneBody = src.slice(insertOneStart, insertOneEnd);
  assert.doesNotMatch(insertOneBody, /ON CONFLICT/i, "insertNighthawkCandidateSnapshot must be a plain INSERT, never an upsert");

  const insertManyStart = src.indexOf("export async function insertNighthawkCandidateSnapshots(");
  assert.ok(insertManyStart > 0, "insertNighthawkCandidateSnapshots not found");
  const insertManyEnd = src.indexOf("\n}\n", insertManyStart);
  const insertManyBody = src.slice(insertManyStart, insertManyEnd);
  assert.doesNotMatch(insertManyBody, /ON CONFLICT/i, "insertNighthawkCandidateSnapshots must be a plain bulk INSERT, never an upsert");
});

test("insertNighthawkCandidateSnapshot: every bound value is parameterized, no raw string interpolation into the SQL text", () => {
  const src = readDbSource();
  const start = src.indexOf("export async function insertNighthawkCandidateSnapshot(row");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);

  // The VALUES clause must be the fixed placeholder list, never a template-interpolated one.
  assert.match(body, /VALUES \(\$1::date,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9\)/, "expected 9 positional placeholders, one per column");
  // ticker is upper-cased in the app layer before binding (matches every sibling writer in this file).
  assert.match(body, /row\.ticker\.toUpperCase\(\)/);
  // snapshot_json is explicitly JSON.stringify'd before binding (pg does not auto-serialize objects
  // bound as query params for a JSONB column).
  assert.match(body, /JSON\.stringify\(row\.snapshot_json\)/);
});

test("insertNighthawkCandidateSnapshots: bulk INSERT builds one parameterized tuple per row, values array length matches", () => {
  const src = readDbSource();
  const start = src.indexOf("export async function insertNighthawkCandidateSnapshots(");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);

  // Guards against writing zero rows as a malformed empty INSERT.
  assert.match(body, /if \(!rows\.length\) return;/);
  // Each tuple is built from 9 sequentially-numbered placeholders derived from the row index,
  // never a literal/interpolated value.
  assert.match(body, /const base = i \* 9;/);
  assert.match(body, /\$\{base \+ 1\}::date/);
  assert.match(body, /\$\{base \+ 9\}/);
});

test("fetchNighthawkCandidateSnapshots: optional ticker/stage filters are parameterized, never string-concatenated", () => {
  const src = readDbSource();
  const start = src.indexOf("export async function fetchNighthawkCandidateSnapshots(");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);

  assert.match(body, /conditions\.push\(`ticker = \$\$\{params\.length\}`\)/);
  assert.match(body, /conditions\.push\(`stage = \$\$\{params\.length\}`\)/);
  assert.match(body, /params\.push\(opts\.ticker\.toUpperCase\(\)\)/);
  assert.match(body, /params\.push\(opts\.stage\)/);
  // Always scoped to one edition -- a query with neither ticker nor stage still can't scan the
  // whole table.
  assert.match(body, /edition_for = \$1::date/);
  // Oldest-first, so a caller reconstructing a candidate's stage-by-stage history sees rows in
  // the order the pipeline actually produced them.
  assert.match(body, /ORDER BY observed_at ASC, id ASC/);
});
