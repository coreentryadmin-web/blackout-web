// Regression test for 016_cri_banger_peak_correction.sql — a one-off DATA correction (not a
// schema migration), applied once via POST /api/admin/run-migration.
//
// WHAT COULD GO WRONG WITHOUT THIS TEST: the whole safety argument for running an UPDATE against
// production through the generic /api/admin/run-migration route is that its WHERE clause is
// narrowly guarded to the exact corrupted row (see the .sql file's own header for the full
// incident writeup). A future edit to this file — even a "harmless" cleanup that drops what looks
// like a redundant guard column — could silently widen the blast radius to every banger_positions
// row that happens to share ANY ONE of these values (e.g. every row with peak_premium=2.8, or
// every CLOSED_RUNNER row). This test parses the SQL text and asserts every guard clause is still
// present, so a future accidental loosening fails CI instead of landing in production the next
// time someone re-points /api/admin/run-migration at this filename.
//
// This is a string/structural check on the committed .sql file, not a live DB test (this repo's
// migration files have no DB-integration test precedent — see src/lib/migrations/*.sql, none of
// the prior 15 have a sibling test — and this sandbox cannot reach Postgres directly per
// CLAUDE.md's "direct Postgres is blocked" note). Asserting on the literal SQL text is still a
// real regression test: it fails RED if the guard is loosened or removed, and passes GREEN only
// when every clause below is intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SQL_PATH = path.join(__dirname, "016_cri_banger_peak_correction.sql");
const sql = fs.readFileSync(SQL_PATH, "utf8");

// Pull out just the UPDATE statement's own text (ignore the comment header above it) so a prose
// edit to the comments can never accidentally satisfy/fail these assertions.
const updateStatement = sql.slice(sql.indexOf("UPDATE banger_positions"));

test("016 correction touches exactly one table: banger_positions", () => {
  assert.match(updateStatement, /^UPDATE banger_positions\b/);
});

test("016 correction's WHERE clause is guarded on the row's real primary key", () => {
  assert.match(updateStatement, /WHERE[\s\S]*\bid\s*=\s*1510\b/);
});

test("016 correction's WHERE clause re-confirms ticker AND contract_occ (not id alone)", () => {
  // NOTE: no trailing \b after the closing quote — \b is a transition between a word and a
  // non-word character, and `'` is itself non-word, so `'...'\b` can never match whatever
  // (whitespace/newline) follows a quoted literal in this file. The leading \b (before a bare
  // identifier like `ticker`) is still meaningful and kept.
  assert.match(updateStatement, /\bticker\s*=\s*'CRI'/);
  assert.match(updateStatement, /\bcontract_occ\s*=\s*'O:CRI261016C00035000'/);
});

test("016 correction's WHERE clause is guarded on the EXACT corrupted values — never a bare id match", () => {
  // These three are the fingerprint of the fabricated-close incident. If any one of them is
  // dropped from the WHERE clause, the guard stops proving "this is the row the incident
  // described" and starts proving nothing beyond "id=1510", which is a much weaker promise than
  // the .sql file's own header claims.
  assert.match(updateStatement, /\bpeak_premium\s*=\s*2\.8\b/);
  assert.match(updateStatement, /\bstatus\s*=\s*'CLOSED_RUNNER'/);
  assert.match(updateStatement, /\bscale_out_action\s*=\s*'EXIT_RUNNER'/);
});

test("016 correction resets every field the fabricated TAKE_PARTIAL/EXIT_RUNNER transitions touched", () => {
  // Mirrors live-sync.ts's own write list for TAKE_PARTIAL/EXIT_RUNNER (status, scaled_already,
  // scale_out_action, scale_out_reason, partial_realized_premium, realized_pnl_pct,
  // realized_pnl_usd, closed_at) plus peak_premium itself — undoing a subset would leave the row
  // in a state live-sync.ts's own code never produces naturally (e.g. scaled_already=false but a
  // stale partial_realized_premium still set).
  const setClause = updateStatement.slice(0, updateStatement.indexOf("WHERE"));
  for (const assignment of [
    "status = 'OPEN'",
    "peak_premium = 0.55",
    "scaled_already = FALSE",
    "scale_out_action = NULL",
    "scale_out_reason = NULL",
    "partial_realized_premium = NULL",
    "realized_pnl_pct = NULL",
    "realized_pnl_usd = NULL",
    "closed_at = NULL",
  ]) {
    assert.ok(
      setClause.includes(assignment),
      `expected SET clause to include "${assignment}"`,
    );
  }
});

test("016 correction's reset peak_premium (0.55) matches the row's own entry_premium, not an invented number", () => {
  // The .sql header's evidence trail: this contract's real reliable_mark never exceeded entry
  // (0.55) in its whole life, so the honest peak IS the entry price. Pinning both tests to the
  // same literal keeps this test from silently drifting out of sync with the .sql file if either
  // is edited in isolation.
  assert.match(updateStatement, /peak_premium\s*=\s*0\.55/);
  assert.match(updateStatement, /contract_occ\s*=\s*'O:CRI261016C00035000'/);
});

test("016 correction is a single statement (no additional UPDATE/DELETE hiding after it)", () => {
  // A second statement appended later (e.g. by a careless future edit reusing this file) would run
  // inside the SAME transaction applyMigrationFile wraps every file in — guard against that drift
  // by asserting there is exactly one semicolon-terminated statement in the file.
  const statements = updateStatement
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.equal(statements.length, 1, "expected exactly one SQL statement in this correction file");
});
