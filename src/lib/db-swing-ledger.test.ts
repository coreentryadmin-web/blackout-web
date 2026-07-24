import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mapSwingPositionRow,
  mapSwingSnapshotRow,
  mapSwingAccumRow,
  isMonotonicSwingStatusTransition,
  coalescePinnedColumns,
} from "./db";

// The swing ledger (PR-10) is schema-only and Postgres is NOT exercised in CI (same
// constraint as db.test.ts). So the unit tests here cover the PURE, exported core —
// the row mappers (NUMERIC-string→number, null-stays-null, ISO normalization, JSONB
// parse), the monotonic status validator, and the COALESCE-pin fragment builder — plus
// source-inspection assertions that the accessors carry the three ledger invariants
// (roll chain, first-write-wins pinning, monotonic status) in their SQL.

// ─── mapSwingPositionRow ──────────────────────────────────────────────────────

test("mapSwingPositionRow: NUMERIC columns arriving as strings (node-pg) become real numbers", () => {
  const row = mapSwingPositionRow({
    id: "17",
    commit_key: "2026-07-24:NVDA:STANDARD:long",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: "0",
    session_date: "2026-07-24",
    ticker: "NVDA",
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: "180",
    contract_strike: "175.5",
    contract_expiry: "2026-08-15",
    contract_type: "call",
    contract_occ: "NVDA260815C00175500",
    contract_delta: "0.6",
    entry_underlying_px: "178.42",
    thesis_invalidation_px: "170",
    target_underlying_px: "200",
    entry_premium: "8.35",
    last_mark: "9.10",
    peak_premium: "12.00",
    trough_premium: "7.20",
    underlying_mfe: "5.5",
    underlying_mae: "-2.1",
    realized_pnl_pct: null,
    entry_context: { vix_open: 14.2 },
    gate_calibration_json: { verdict: "COMMIT" },
    feature_vector: { v: 1 },
    plan_json: { occ: "NVDA260815C00175500" },
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "OPEN",
    first_seen_at: "2026-07-24T14:30:00.000Z",
    committed_at: "2026-07-24T14:30:00.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-07-24T15:00:00.000Z",
  });

  assert.equal(row.id, 17);
  assert.equal(typeof row.contract_strike, "number");
  assert.equal(row.contract_strike, 175.5);
  assert.equal(typeof row.contract_delta, "number");
  assert.equal(row.contract_delta, 0.6);
  assert.equal(row.entry_premium, 8.35);
  assert.equal(row.underlying_mae, -2.1);
  assert.equal(row.roll_seq, 0);
  assert.equal(row.direction, "long");
});

test("mapSwingPositionRow: null NUMERIC/JSONB/timestamp columns stay null, never a 0 or a 'null' string", () => {
  const row = mapSwingPositionRow({
    id: 1,
    commit_key: "k",
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-07-24",
    ticker: "SPY",
    direction: "short",
    sub_lane: "TACTICAL",
    archetype: null,
    top_flow_strike: null,
    contract_strike: null,
    contract_expiry: null,
    contract_type: null,
    contract_occ: null,
    contract_delta: null,
    entry_underlying_px: null,
    thesis_invalidation_px: null,
    target_underlying_px: null,
    entry_premium: null,
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    underlying_mfe: null,
    underlying_mae: null,
    realized_pnl_pct: null,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "PENDING",
    first_seen_at: "2026-07-24T14:30:00.000Z",
    committed_at: null,
    closed_at: null,
    graded_at: null,
    updated_at: "2026-07-24T14:30:00.000Z",
  });

  assert.equal(row.archetype, null);
  assert.equal(row.contract_strike, null, "a null NUMERIC must not collapse to 0");
  assert.equal(row.entry_premium, null);
  assert.equal(row.entry_context, null);
  assert.equal(row.grade_json, null);
  assert.equal(row.committed_at, null);
  assert.equal(row.graded_at, null);
  assert.equal(row.direction, "short");
});

test("mapSwingPositionRow: DATE/TIMESTAMPTZ normalize to ISO; JSONB delivered as a string is parsed", () => {
  const row = mapSwingPositionRow({
    id: 2,
    commit_key: "k2",
    root_position_id: "5",
    parent_position_id: "5",
    roll_seq: 1,
    // A Date instance (what node-pg hands back for a DATE column) must ISO-normalize.
    session_date: new Date("2026-07-24T00:00:00.000Z"),
    ticker: "AAPL",
    direction: "long",
    sub_lane: "EXTENDED",
    archetype: "PULLBACK_CONTINUATION",
    top_flow_strike: null,
    contract_strike: null,
    contract_expiry: new Date("2026-08-21T00:00:00.000Z"),
    contract_type: "call",
    contract_occ: null,
    contract_delta: null,
    entry_underlying_px: null,
    thesis_invalidation_px: null,
    target_underlying_px: null,
    entry_premium: null,
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    underlying_mfe: null,
    underlying_mae: null,
    realized_pnl_pct: "13.5",
    // Some pool configs surface jsonb as a raw string — the mapper must JSON.parse it.
    entry_context: '{"vix_open":15.1}',
    gate_calibration_json: null,
    feature_vector: '{"v":1,"score":72}',
    plan_json: null,
    scale_out_grade: null,
    grade_json: '{"financial":{"realized_mult":1.9}}',
    grade_methodology: "swing.v1",
    legacy_grade: null,
    status: "CLOSED",
    first_seen_at: new Date("2026-07-24T14:30:00.000Z"),
    committed_at: new Date("2026-07-24T14:30:00.000Z"),
    closed_at: new Date("2026-08-01T20:00:00.000Z"),
    graded_at: new Date("2026-08-02T09:00:00.000Z"),
    updated_at: new Date("2026-08-02T09:00:00.000Z"),
  });

  assert.equal(row.session_date, "2026-07-24");
  assert.equal(row.contract_expiry, "2026-08-21");
  assert.equal(row.root_position_id, 5);
  assert.equal(row.realized_pnl_pct, 13.5);
  assert.deepEqual(row.entry_context, { vix_open: 15.1 }, "string JSONB must be parsed to an object");
  assert.deepEqual(row.feature_vector, { v: 1, score: 72 });
  assert.deepEqual(row.grade_json, { financial: { realized_mult: 1.9 } });
  assert.equal(row.first_seen_at, "2026-07-24T14:30:00.000Z");
  assert.equal(row.graded_at, "2026-08-02T09:00:00.000Z");
});

// ─── mapSwingSnapshotRow ──────────────────────────────────────────────────────

test("mapSwingSnapshotRow: NUMERIC→number, null stays null, JSONB parsed, created_at ISO", () => {
  const row = mapSwingSnapshotRow({
    id: "99",
    position_id: "17",
    snapshot_kind: "eod",
    dte_remaining: "12",
    underlying_px: "179.55",
    option_mark: "9.40",
    running_mfe: "6.1",
    running_mae: null,
    thesis_state: "CONFIRMED",
    feature_vector: '{"v":1}',
    event_json: null,
    created_at: "2026-07-25T20:00:00.000Z",
  });
  assert.equal(row.id, 99);
  assert.equal(row.position_id, 17);
  assert.equal(row.dte_remaining, 12);
  assert.equal(typeof row.underlying_px, "number");
  assert.equal(row.underlying_px, 179.55);
  assert.equal(row.running_mae, null);
  assert.deepEqual(row.feature_vector, { v: 1 });
  assert.equal(row.event_json, null);
  assert.equal(row.created_at, "2026-07-25T20:00:00.000Z");
});

// ─── mapSwingAccumRow ─────────────────────────────────────────────────────────

test("mapSwingAccumRow: counts→number, phases + signal_kinds JSONB array→string[], last_session_day ISO", () => {
  const row = mapSwingAccumRow({
    ticker: "SMH",
    direction: "long",
    observation_count: "4",
    distinct_session_days: "2",
    last_session_day: new Date("2026-07-24T00:00:00.000Z"),
    phases_seen: ["POST_CLOSE", "MIDDAY"],
    signal_kinds: ["FLOW", "CATALYST"],
    promoted_position_id: null,
    first_seen_at: "2026-07-23T20:00:00.000Z",
    last_seen_at: "2026-07-24T20:00:00.000Z",
  });
  assert.equal(row.observation_count, 4);
  assert.equal(row.distinct_session_days, 2);
  assert.equal(row.last_session_day, "2026-07-24");
  assert.deepEqual(row.phases_seen, ["POST_CLOSE", "MIDDAY"]);
  assert.deepEqual(row.signal_kinds, ["FLOW", "CATALYST"], "screen provenance parses into the corroboration set");
  assert.equal(row.promoted_position_id, null);

  // phases_seen / signal_kinds delivered as raw JSON strings are still parsed to string[]; a legacy row
  // with NO signal_kinds column maps to null (handled downstream as an empty corroboration set).
  const row2 = mapSwingAccumRow({
    ticker: "QQQ",
    direction: "short",
    observation_count: 1,
    distinct_session_days: 1,
    last_session_day: null,
    phases_seen: '["OPEN"]',
    signal_kinds: '["STRUCTURE"]',
    promoted_position_id: "42",
    first_seen_at: "2026-07-24T14:00:00.000Z",
    last_seen_at: "2026-07-24T14:00:00.000Z",
  });
  assert.deepEqual(row2.phases_seen, ["OPEN"]);
  assert.deepEqual(row2.signal_kinds, ["STRUCTURE"]);
  assert.equal(row2.promoted_position_id, 42);
  assert.equal(row2.last_session_day, null);
  assert.equal(row2.direction, "short");

  // A legacy row missing the signal_kinds column entirely → null (never throws).
  const legacy = mapSwingAccumRow({
    ticker: "AMD", direction: "long", observation_count: 2, distinct_session_days: 2,
    last_session_day: null, phases_seen: ["POST_CLOSE"], promoted_position_id: null,
    first_seen_at: "2026-07-24T14:00:00.000Z", last_seen_at: "2026-07-24T14:00:00.000Z",
  });
  assert.equal(legacy.signal_kinds, null, "legacy row with no signal_kinds column maps to null");
});

// ─── isMonotonicSwingStatusTransition ─────────────────────────────────────────

test("isMonotonicSwingStatusTransition: valid forward steps along the ladder are allowed", () => {
  assert.equal(isMonotonicSwingStatusTransition("PENDING", "OPEN"), true);
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "HOLD"), true);
  assert.equal(isMonotonicSwingStatusTransition("HOLD", "OPEN"), true, "OPEN↔HOLD is a legal lateral");
  assert.equal(isMonotonicSwingStatusTransition("HOLD", "TRIM"), true);
  assert.equal(isMonotonicSwingStatusTransition("TRIM", "CLOSED"), true);
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "ROLLED"), true);
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "OPEN"), true, "idempotent no-op is legal");
});

test("isMonotonicSwingStatusTransition: regressions are rejected", () => {
  assert.equal(isMonotonicSwingStatusTransition("CLOSED", "OPEN"), false, "terminal CLOSED cannot reopen");
  assert.equal(isMonotonicSwingStatusTransition("ROLLED", "OPEN"), false, "terminal ROLLED cannot reopen");
  assert.equal(isMonotonicSwingStatusTransition("ROLLED", "CLOSED"), false, "terminal is frozen even to another terminal");
  assert.equal(isMonotonicSwingStatusTransition("TRIM", "OPEN"), false, "TRIM is sticky — never un-trims");
  assert.equal(isMonotonicSwingStatusTransition("TRIM", "HOLD"), false);
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "PENDING"), false, "never regress to PENDING");
  assert.equal(isMonotonicSwingStatusTransition("HOLD", "PENDING"), false);
});

test("isMonotonicSwingStatusTransition: ROLLED and CLOSED are both reachable terminals; unknown status fails closed", () => {
  assert.equal(isMonotonicSwingStatusTransition("HOLD", "ROLLED"), true);
  assert.equal(isMonotonicSwingStatusTransition("PENDING", "CLOSED"), true);
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "BOGUS"), false, "unknown target rejected");
  assert.equal(isMonotonicSwingStatusTransition("BOGUS", "OPEN"), false, "unknown source rejected");
});

// ─── coalescePinnedColumns (first-write-wins) ─────────────────────────────────

test("coalescePinnedColumns: emits COALESCE(<table>.col, EXCLUDED.col) — existing value wins", () => {
  const frag = coalescePinnedColumns("swing_positions", ["entry_context"]);
  assert.equal(frag, "entry_context = COALESCE(swing_positions.entry_context, EXCLUDED.entry_context)");
  // The COALESCE argument ORDER is the whole point of first-write-wins: the already-stored
  // (left) value is preferred over the incoming EXCLUDED (right) value.
  assert.match(frag, /COALESCE\(swing_positions\.entry_context,\s*EXCLUDED\.entry_context\)/);

  const multi = coalescePinnedColumns("swing_positions", ["direction", "plan_json"]);
  assert.match(multi, /direction = COALESCE\(swing_positions\.direction, EXCLUDED\.direction\)/);
  assert.match(multi, /plan_json = COALESCE\(swing_positions\.plan_json, EXCLUDED\.plan_json\)/);
});

// ─── SQL-level invariant guards (source inspection — no live PG in CI) ─────────

function dbSource(): string {
  return readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
}

test("insertSwingPosition: pins commit-time context blobs first-write-wins in the ON CONFLICT", () => {
  const src = dbSource();
  const body = src.slice(
    src.indexOf("export async function insertSwingPosition"),
    src.indexOf("export async function updateSwingLiveState")
  );
  assert.match(body, /ON CONFLICT \(commit_key\) DO UPDATE SET/);
  // The pinned set is built via coalescePinnedColumns over SWING_POSITION_PINNED_COLUMNS —
  // assert the load-bearing commit-time blobs are in that list.
  const listStart = src.indexOf("const SWING_POSITION_PINNED_COLUMNS = [");
  const pinnedList = src.slice(listStart, src.indexOf("] as const", listStart));
  assert.ok(listStart > 0, "SWING_POSITION_PINNED_COLUMNS declaration exists");
  for (const col of ["entry_context", "gate_calibration_json", "feature_vector", "plan_json", "direction", "contract_strike"]) {
    assert.ok(
      new RegExp(`"${col}"`).test(pinnedList),
      `${col} must be COALESCE-pinned first-write-wins`
    );
  }
});

test("updateSwingLiveState: SQL status CASE is monotonic — terminal frozen, TRIM sticky, no regress to PENDING", () => {
  const src = dbSource();
  const start = src.indexOf("export async function updateSwingLiveState");
  const body = src.slice(start, src.indexOf("export async function gradeSwingPosition"));
  // Terminal states are frozen (mirror of the pure validator).
  assert.match(body, /WHEN status IN \('CLOSED','ROLLED'\) THEN status/);
  // TRIM never demotes back to a live/pending rung.
  assert.match(body, /WHEN status = 'TRIM' AND \$2 IN \('PENDING','OPEN','HOLD'\) THEN status/);
  // OPEN/HOLD never regress to PENDING.
  assert.match(body, /WHEN status IN \('OPEN','HOLD'\) AND \$2 = 'PENDING' THEN status/);
  // Legitimate forward/lateral transitions still pass through.
  assert.match(body, /ELSE \$2/);
  // Marks + peak/trough + underlying MFE/MAE still latch even when the status write is dropped.
  assert.match(body, /GREATEST\(COALESCE\(peak_premium, \$3\), \$3\)/);
  assert.match(body, /LEAST\(COALESCE\(trough_premium, \$3\), \$3\)/);
  assert.match(body, /GREATEST\(COALESCE\(underlying_mfe, \$4\), \$4\)/);
  assert.match(body, /LEAST\(COALESCE\(underlying_mae, \$5\), \$5\)/);
});

test("gradeSwingPosition / pinSwingScaleOutGrade: graded-once + scale-out first-write-wins guards", () => {
  const src = dbSource();
  const gradeBody = src.slice(
    src.indexOf("export async function gradeSwingPosition"),
    src.indexOf("export async function pinSwingScaleOutGrade")
  );
  // A leg is graded exactly once — the frozen realized_pnl_pct can't be re-litigated.
  assert.match(gradeBody, /WHERE id = \$1 AND graded_at IS NULL/);
  // A ROLLED leg stays ROLLED even when the grader closes it out.
  assert.match(gradeBody, /WHEN status = 'ROLLED' THEN 'ROLLED'/);

  const pinBody = src.slice(
    src.indexOf("export async function pinSwingScaleOutGrade"),
    src.indexOf("export async function fetchOpenSwingPositions")
  );
  assert.match(pinBody, /WHERE id = \$1 AND scale_out_grade IS NULL/);
});

test("fetchSwingPositionChain: walks the roll chain by root and orders by roll_seq (invariant #1)", () => {
  const src = dbSource();
  const body = src.slice(
    src.indexOf("export async function fetchSwingPositionChain"),
    src.indexOf("export async function fetchGradedSwingFeatureRows")
  );
  assert.match(body, /WHERE id = \$1 OR root_position_id = \$1/);
  assert.match(body, /ORDER BY roll_seq ASC/);
});

test("swing DDL: three tables created, snapshots append-only (FK), commit_key unique", () => {
  const src = dbSource();
  assert.match(src, /CREATE TABLE IF NOT EXISTS swing_positions/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS swing_position_snapshots/);
  assert.match(src, /CREATE TABLE IF NOT EXISTS swing_candidate_accumulation/);
  assert.match(src, /CREATE UNIQUE INDEX IF NOT EXISTS uq_swing_positions_commit_key ON swing_positions\(commit_key\)/);
  // Snapshots FK the parent and cascade — append-only series is owned by the position.
  assert.match(src, /position_id BIGINT NOT NULL REFERENCES swing_positions\(id\) ON DELETE CASCADE/);
});

// ─── SEV-2: fail-closed status guard — pure validator vs SQL-CASE evaluator agree ─────────────

// A faithful mirror of updateSwingLiveState's status CASE (the exact arm order), returning the
// RESULTING status. The write "took effect" iff the result equals the requested `to`. This lets us
// prove the pure isMonotonicSwingStatusTransition and the SQL CASE agree on legality — crucially,
// that BOTH reject a value OFF the ladder (the SEV-2 fail-open bug: the old CASE fell through to
// ELSE $2 and persisted an unknown status verbatim).
const SWING_STATUS_LADDER = new Set(["PENDING", "OPEN", "HOLD", "TRIM", "CLOSED", "ROLLED"]);
function evalSwingStatusCase(from: string, to: string): string {
  if (from === "CLOSED" || from === "ROLLED") return from; // terminal frozen
  if (from === "TRIM" && (to === "PENDING" || to === "OPEN" || to === "HOLD")) return from; // TRIM sticky
  if ((from === "OPEN" || from === "HOLD") && to === "PENDING") return from; // no regress to PENDING
  if (!SWING_STATUS_LADDER.has(to)) return from; // SEV-2 fail-CLOSED final arm — unknown target dropped
  return to; // ELSE $2
}

test("SEV-2: fail-closed status guard — pure validator and SQL-CASE evaluator agree (unknown 'CLOSE' typo rejected by both)", () => {
  // (from, to) drive table — every `from` is a VALID ladder rung (an unknown SOURCE can never be
  // stored: the DB CHECK constraint forbids it, so the CASE is only ever fed a valid current status).
  const table: Array<[string, string]> = [
    ["PENDING", "OPEN"],
    ["OPEN", "HOLD"],
    ["HOLD", "OPEN"],
    ["HOLD", "TRIM"],
    ["TRIM", "CLOSED"],
    ["OPEN", "ROLLED"],
    ["OPEN", "OPEN"], // idempotent no-op
    ["CLOSED", "OPEN"], // terminal cannot reopen
    ["ROLLED", "CLOSED"], // terminal frozen even to another terminal
    ["TRIM", "OPEN"], // TRIM never un-trims
    ["OPEN", "PENDING"], // never regress
    ["OPEN", "CLOSE"], // ← the unknown-target typo (should be CLOSED) — MUST be rejected
    ["HOLD", "ROLL"], // ← another off-ladder typo (should be ROLLED)
    ["PENDING", "ARCHIVED"], // ← invented status a future caller might pass
  ];
  for (const [from, to] of table) {
    const pureLegal = isMonotonicSwingStatusTransition(from, to);
    const sqlLegal = evalSwingStatusCase(from, to) === to;
    assert.equal(
      pureLegal,
      sqlLegal,
      `pure and SQL disagree on ${from}→${to} (pure=${pureLegal}, sql=${sqlLegal})`
    );
  }
  // Spell out the load-bearing case: the unknown target is rejected by BOTH (fail-closed).
  assert.equal(isMonotonicSwingStatusTransition("OPEN", "CLOSE"), false);
  assert.equal(evalSwingStatusCase("OPEN", "CLOSE"), "OPEN", "SQL keeps current status on an unknown target");
});

test("SEV-2: updateSwingLiveState SQL carries the fail-closed final arm + swing_positions has a status CHECK constraint", () => {
  const src = dbSource();
  const start = src.indexOf("export async function updateSwingLiveState");
  const body = src.slice(start, src.indexOf("export async function gradeSwingPosition"));
  // The new fail-closed arm: an off-ladder target keeps the current status (no verbatim write).
  assert.match(
    body,
    /WHEN \$2 NOT IN \('PENDING','OPEN','HOLD','TRIM','CLOSED','ROLLED'\) THEN status/,
    "fail-closed final arm must precede ELSE $2"
  );
  // The arm must come BEFORE the ELSE (order matters — ELSE is the last resort). lastIndexOf skips the
  // "fell through to ELSE $2" mention in the explanatory comment and finds the real clause.
  const armIdx = body.indexOf("WHEN $2 NOT IN ('PENDING'");
  const elseIdx = body.lastIndexOf("ELSE $2");
  assert.ok(armIdx > 0 && elseIdx > armIdx, "fail-closed arm is positioned before ELSE $2");
  // Schema-level backstop: a CHECK constraint pins status to the ladder, added idempotently.
  assert.match(src, /ADD CONSTRAINT swing_positions_status_ck\s+CHECK \(status IN \('PENDING','OPEN','HOLD','TRIM','CLOSED','ROLLED'\)\)/);
  assert.match(src, /EXCEPTION WHEN duplicate_object THEN NULL/, "CHECK add is idempotent (re-run safe)");
});

// ─── SEV-3: distinct_session_days strictly-newer guard ────────────────────────────────────────

// Mirror of the upsertSwingAccum ON CONFLICT day-accounting: increment ONLY on a strictly-newer
// day (or a null high-water mark), and pin last_session_day to GREATEST so an out-of-order day
// neither increments nor rewinds.
function evalAccumDay(
  existing: { days: number; last: string | null },
  incoming: string
): { days: number; last: string } {
  const bump = existing.last === null || incoming > existing.last ? 1 : 0;
  const last = existing.last === null || incoming > existing.last ? incoming : existing.last; // GREATEST
  return { days: existing.days + bump, last };
}

test("SEV-3: distinct_session_days increments ONLY on a strictly-newer day; out-of-order neither counts nor rewinds", () => {
  // A genuinely new (later) session → +1 and the high-water mark advances.
  assert.deepEqual(evalAccumDay({ days: 1, last: "2026-07-23" }, "2026-07-24"), { days: 2, last: "2026-07-24" });
  // Same day repeat (multiple scans in one session) → no increment, mark unchanged.
  assert.deepEqual(evalAccumDay({ days: 2, last: "2026-07-24" }, "2026-07-24"), { days: 2, last: "2026-07-24" });
  // OUT-OF-ORDER older day (a re-run/backfill) → the old bug (+1 and rewind) is gone: no increment, no rewind.
  assert.deepEqual(evalAccumDay({ days: 2, last: "2026-07-24" }, "2026-07-22"), { days: 2, last: "2026-07-24" });
  // A brand-new dated observation on a legacy null high-water mark counts once.
  assert.deepEqual(evalAccumDay({ days: 0, last: null }, "2026-07-24"), { days: 1, last: "2026-07-24" });

  // A replayed older day followed by the correct in-order day still totals TWO distinct days, not three:
  // the replay was a no-op, so the forward day is counted exactly once (the old IS DISTINCT FROM logic
  // would have counted the replay AND then re-counted 07-24 → 4).
  let st = { days: 1, last: "2026-07-23" };
  st = evalAccumDay(st, "2026-07-22"); // out-of-order replay — no-op
  st = evalAccumDay(st, "2026-07-24"); // genuine next session — +1
  assert.deepEqual(st, { days: 2, last: "2026-07-24" });
});

test("SEV-3: upsertSwingAccum SQL uses strictly-newer (>) increment + GREATEST high-water mark", () => {
  const src = dbSource();
  const body = src.slice(
    src.indexOf("export async function upsertSwingAccum"),
    src.indexOf("export async function fetchAccumulating")
  );
  // Increment only on strictly-newer (or null) — no longer the fail-open IS DISTINCT FROM.
  assert.match(body, /EXCLUDED\.last_session_day > swing_candidate_accumulation\.last_session_day/);
  assert.doesNotMatch(body, /IS DISTINCT FROM EXCLUDED\.last_session_day/, "the buggy IS DISTINCT FROM guard is gone");
  // High-water mark pinned to GREATEST so an out-of-order day cannot rewind it.
  assert.match(body, /last_session_day = GREATEST\(swing_candidate_accumulation\.last_session_day, EXCLUDED\.last_session_day\)/);
});

test("signal_kinds: DDL adds the column, upsertSwingAccum deduped-unions it (the corroboration set)", () => {
  const src = dbSource();
  // The column is added idempotently (ADD COLUMN IF NOT EXISTS) so an existing deploy migrates in place.
  assert.match(src, /ALTER TABLE swing_candidate_accumulation\s+ADD COLUMN IF NOT EXISTS signal_kinds JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  const body = src.slice(
    src.indexOf("export async function upsertSwingAccum"),
    src.indexOf("export async function fetchAccumulating")
  );
  // signal_kinds is written on insert and deduped-unioned on conflict — the same jsonb_agg(DISTINCT) shape
  // phases_seen uses, but a SEPARATE column so a legacy cadence-only phases_seen can't leak in as a kind.
  assert.match(body, /signal_kinds = \(\s*SELECT COALESCE\(jsonb_agg\(DISTINCT e\), '\[\]'::jsonb\)/);
  assert.match(body, /jsonb_array_elements\(swing_candidate_accumulation\.signal_kinds \|\| EXCLUDED\.signal_kinds\)/);
});

// ─── SEV-4: root/parent identity not clobbered + graded-feature index ─────────────────────────

test("SEV-4: root_position_id and parent_position_id are EXCLUDED from the upsert DO UPDATE SET (identity fixed at first insert)", () => {
  const src = dbSource();
  const listStart = src.indexOf("const SWING_POSITION_PINNED_COLUMNS = [");
  const pinnedList = src.slice(listStart, src.indexOf("] as const", listStart));
  assert.ok(listStart > 0, "SWING_POSITION_PINNED_COLUMNS declaration exists");
  // These two are the roll-chain identity — a root row's meaningful NULL must never be overwritten,
  // so they are NOT in the COALESCE-pinned SET at all (a column absent from the SET is left untouched).
  assert.doesNotMatch(pinnedList, /"root_position_id"/, "root_position_id must NOT be in the DO UPDATE SET");
  assert.doesNotMatch(pinnedList, /"parent_position_id"/, "parent_position_id must NOT be in the DO UPDATE SET");
  // Commit-time blobs are still pinned first-write-wins (unchanged).
  for (const col of ["entry_context", "gate_calibration_json", "feature_vector", "plan_json", "roll_seq"]) {
    assert.ok(new RegExp(`"${col}"`).test(pinnedList), `${col} stays COALESCE-pinned`);
  }
});

test("SEV-4: fetchGradedSwingFeatureRows is backed by a partial index matching its predicate", () => {
  const src = dbSource();
  assert.match(
    src,
    /CREATE INDEX IF NOT EXISTS idx_swing_positions_graded_features\s+ON swing_positions\(session_date DESC\)\s+WHERE graded_at IS NOT NULL AND feature_vector IS NOT NULL/
  );
});

// ─── SEV-3: transactional roll helper (withSwingRollTx) — source invariants ───────────────────

test("SEV-3: withSwingRollTx wraps child-insert + parent-grade in BEGIN/COMMIT and treats a 0-row grade as an error", () => {
  const src = dbSource();
  const body = src.slice(
    src.indexOf("export async function withSwingRollTx"),
    src.indexOf("export async function pinSwingScaleOutGrade")
  );
  assert.ok(body.length > 0, "withSwingRollTx exists");
  assert.match(body, /await client\.query\("BEGIN"\)/);
  assert.match(body, /await client\.query\("COMMIT"\)/);
  assert.match(body, /await client\.query\("ROLLBACK"\)/, "rolls back on any error");
  // The bound gradeParent reports rowcount and THROWS on 0 (grade race) → the tx rolls back the child too.
  assert.match(body, /if \(affected === 0\)/);
  assert.match(body, /grade affected 0 rows/);
  // gradeSwingPosition now returns the affected rowcount (was void) so the 0-row race is detectable.
  const gradeBody = src.slice(
    src.indexOf("export async function gradeSwingPosition"),
    src.indexOf("export async function withSwingRollTx")
  );
  assert.match(gradeBody, /\): Promise<number> \{/, "gradeSwingPosition returns affected rowcount");
  assert.match(gradeBody, /return res\.rowCount \?\? 0/);
});
