import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapAlertAuditTrailRow, computeSafePgPoolMaxDefault } from "./db";

test("mapAlertAuditTrailRow: converts NUMERIC confidence_score (a string from node-pg) to a real number", () => {
  const row = mapAlertAuditTrailRow({
    id: "42",
    alert_type: "zerodte",
    ticker: "nvda",
    direction: "long",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: "82.5",
    confidence_label: "high",
    trigger_reason: "aggression spike",
    outcome: "target",
  });
  assert.equal(row.id, 42);
  assert.equal(typeof row.confidence_score, "number");
  assert.equal(row.confidence_score, 82.5);
});

test("mapAlertAuditTrailRow: null direction/confidence/trigger_reason/outcome stay null, not 'null' strings", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "nighthawk_rejected",
    ticker: "TSLA",
    direction: null,
    fired_at: "2026-07-01T00:00:00.000Z",
    confidence_score: null,
    confidence_label: null,
    trigger_reason: null,
    outcome: null,
  });
  assert.equal(row.direction, null);
  assert.equal(row.confidence_score, null);
  assert.equal(row.confidence_label, null);
  assert.equal(row.trigger_reason, null);
  assert.equal(row.outcome, null);
});

test("mapAlertAuditTrailRow: fired_at normalizes to an ISO string regardless of the driver's returned format", () => {
  const row = mapAlertAuditTrailRow({
    id: 1,
    alert_type: "zerodte",
    ticker: "SPY",
    direction: "short",
    fired_at: "2026-07-01T14:30:00.000Z",
    confidence_score: 50,
    confidence_label: "medium",
    trigger_reason: null,
    outcome: "pending",
  });
  assert.equal(row.fired_at, "2026-07-01T14:30:00.000Z");
});

// Regression: PG_POOL_MAX's fallback default used to be a flat 5, uncoupled from PgBouncer's
// actual backend budget or REPLICA_COUNT. Production explicitly overrode it to 15, and with 5
// live replicas that's 75 total connections against a documented 20-backend PgBouncer budget —
// a real 3.75x oversubscription a prior "Query read timeout" investigation missed by modeling
// the ceiling off the code default instead of the real production override.
test("computeSafePgPoolMaxDefault: divides the documented PgBouncer budget across live replicas", () => {
  assert.equal(computeSafePgPoolMaxDefault(20, 5), 4);
  assert.equal(computeSafePgPoolMaxDefault(20, 1), 20);
  assert.equal(computeSafePgPoolMaxDefault(20, 4), 5);
});

test("computeSafePgPoolMaxDefault: clamps to a floor of 1 for absurd replica counts", () => {
  assert.equal(computeSafePgPoolMaxDefault(20, 1000), 1);
  assert.equal(computeSafePgPoolMaxDefault(20, 0), 20, "replicaCount<=1 must not divide by zero");
});

test("upsertZeroDteSetupLog: direction/top_strike/expiry are pinned (COALESCE-guarded) in the ON CONFLICT UPDATE", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  // WS-01 extracted the one-and-only upsert SQL into the module-level const
  // ZERODTE_SETUP_LOG_UPSERT_SQL (shared byte-identical by BOTH the plain pooled path
  // upsertZeroDteSetupLog AND the atomic transactional path commitFreshZeroDteRowsAtomic),
  // so pin the COALESCE guard against that single source — it's where the SQL now lives and
  // guarantees neither path can drift the pinning.
  const upsertBody = src.slice(
    src.indexOf("const ZERODTE_SETUP_LOG_UPSERT_SQL"),
    src.indexOf("RETURNING (xmax = 0) AS inserted")
  );
  assert.match(
    upsertBody,
    /direction\s*=\s*COALESCE\(zerodte_setup_log\.direction,\s*EXCLUDED\.direction\)/
  );
  assert.match(
    upsertBody,
    /top_strike\s*=\s*COALESCE\(zerodte_setup_log\.top_strike,\s*EXCLUDED\.top_strike\)/
  );
  assert.match(
    upsertBody,
    /expiry\s*=\s*COALESCE\(zerodte_setup_log\.expiry,\s*EXCLUDED\.expiry\)/
  );
  assert.match(upsertBody, /entry_premium\s*=\s*COALESCE\(zerodte_setup_log\.entry_premium,\s*EXCLUDED\.entry_premium\)/);
  assert.match(upsertBody, /flow_avg_fill\s*=\s*COALESCE\(zerodte_setup_log\.flow_avg_fill,\s*EXCLUDED\.flow_avg_fill\)/);
  assert.match(upsertBody, /plan_json\s*=\s*COALESCE\(zerodte_setup_log\.plan_json,\s*EXCLUDED\.plan_json\)/);
});

// P0 one-way commit door (fix/zerodte-status-latch): status transitions in
// updateZeroDteLiveState only move FORWARD along the real ladder derivePlayStatus
// (zerodte/plan.ts) encodes — OPEN ↔ HOLD are the same live rung (the mark drifting
// in/out of the entry band, legitimate both ways), TRIM is sticky, CLOSED terminal.
// Two independent writers share this UPDATE (the ~2-min cron sync in zerodte/scan.ts
// and the ~1s live-marks lane, each with its OWN latch memo / possibly stale row
// snapshot), so the regression guard has to live IN the SQL — a JS-side check reads
// a status that may already be stale by the time the write lands. Same
// source-inspection idiom as the upsert COALESCE-pin test above (no PG in CI).
test("updateZeroDteLiveState: SQL status CASE is monotonic — CLOSED terminal, TRIM never regresses to OPEN/HOLD", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const start = src.indexOf("export async function updateZeroDteLiveState");
  assert.ok(start > 0, "updateZeroDteLiveState exists");
  const body = src.slice(start, src.indexOf("stampZeroDteExitContext"));
  // CLOSED is terminal (#321) — any write against a CLOSED row keeps CLOSED.
  assert.match(body, /WHEN status = 'CLOSED' THEN status/);
  // TRIM never demotes back to the live rung: a stale writer (pre-target-tag latch)
  // deriving OPEN/HOLD must not un-trim a play members were already told to trim.
  assert.match(body, /WHEN status = 'TRIM' AND \$3 IN \('OPEN','HOLD'\) THEN status/);
  // Legitimate forward/live transitions still pass through.
  assert.match(body, /ELSE \$3/);
  // The mark + peak/trough latches still land even when the status write is dropped
  // (real quote data must never be discarded by the status guard).
  assert.match(body, /GREATEST\(COALESCE\(peak_premium, \$4\), \$4\)/);
  assert.match(body, /LEAST\(COALESCE\(trough_premium, \$4\), \$4\)/);
});

// PR-N1 (P0, docs/audit/NIGHTHAWK-OVERNIGHT-DECISION.md §0.1): ensureSchema used to
// re-issue nighthawk_play_outcomes_outcome_check TWICE — the correct DROP+ADD (with
// 'unfilled') right after the table DDL, then a stale pre-'unfilled' copy ~270 lines
// later that, running last, clobbered the constraint back on every boot. Every
// `outcome = 'unfilled'` grade write then threw, leaving 12 rows permanently
// "pending" while the cron logged ok. Pin: the CHECK is ADDed exactly once, its
// DROP is paired exactly once, and the allowed set is the full 6-outcome union
// resolveOutcome (play-outcomes.ts) can emit. Same source-inspection idiom as the
// tests above (no PG in CI).
// fix/zerodte-aggression-askpct-plumbing (P1): UW does NOT send `ask_side_pct` on the
// flow_alerts feed (live-verified 2026-07-24: 0/2780 rows), so fetchRecentFlows' old
// `(raw_payload->>'ask_side_pct')::numeric AS ask_pct` returned NULL on every row — which
// pinned board.ts aggressionWeight to the neutral 0.5 for every ticker (dead
// SETUP_MIN_AGGR_SHARE gate + direction not aggressor-confirmed). The read path must instead
// DERIVE ask_pct from total_ask_side_prem/total_bid_side_prem (100% coverage) as a 0-100 pct,
// mirroring askPctFromTwoSidedPremium() in flow-raw-fields.ts so REST rows match SSE rows. Raw
// PG is blocked in CI, so pin the SQL by source inspection (same idiom as the tests above).
test("fetchRecentFlows: ask_pct = COALESCE(ask_side_pct, ask/(ask+bid)*100) with a NULLIF divide-by-zero guard", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const fnStart = src.indexOf("export async function fetchRecentFlows");
  assert.ok(fnStart > 0, "fetchRecentFlows exists");
  const body = src.slice(fnStart, src.indexOf("FROM flow_alerts", fnStart));

  // The broken single-field read (the bug) must be gone — it produced NULL on 100% of prod rows.
  assert.doesNotMatch(
    body,
    /\(raw_payload->>'ask_side_pct'\)::numeric AS ask_pct/,
    "the bare ask_side_pct read is the bug — it must be replaced by the COALESCE derivation"
  );

  // Isolate the ask_pct SELECT expression: the COALESCE(...) that ends in "AS ask_pct".
  const askPctIdx = body.indexOf("AS ask_pct");
  assert.ok(askPctIdx > 0, "ask_pct column still selected");
  const expr = body.slice(body.lastIndexOf("COALESCE(", askPctIdx), askPctIdx);
  assert.match(expr, /ask_side_pct/, "primary branch still prefers a real ask_side_pct");
  assert.match(expr, /total_ask_side_prem/, "derived numerator = ask-side premium");
  assert.match(expr, /total_bid_side_prem/, "derived denominator adds bid-side premium");
  assert.match(expr, /\*\s*100 END/, "scaled to the 0-100 ask_pct scale (aggressionWeight 60/45), not 0-1");
  assert.match(
    expr,
    /NULLIF\(\s*\(raw_payload->>'total_ask_side_prem'\)::numeric[\s\S]*?total_bid_side_prem[\s\S]*?,\s*0\)/,
    "NULLIF guards a zero two-sided total -> NULL, never 0 (0 would read as 100% sold)"
  );
});

test("ensureSchema: nighthawk play-outcome CHECK issued exactly once, allowed set includes 'unfilled'", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const adds = src.match(/ADD CONSTRAINT nighthawk_play_outcomes_outcome_check/g) ?? [];
  assert.equal(
    adds.length,
    1,
    "the outcome CHECK must be ADDed exactly once — a later duplicate silently wins on every boot"
  );
  const drops = src.match(/DROP CONSTRAINT IF EXISTS nighthawk_play_outcomes_outcome_check/g) ?? [];
  assert.equal(drops.length, 1, "exactly one DROP, paired with the single ADD");

  // The single surviving ADD must allow everything resolveOutcome can write.
  const addIdx = src.indexOf("ADD CONSTRAINT nighthawk_play_outcomes_outcome_check");
  const stmt = src.slice(addIdx, src.indexOf(")", src.indexOf("CHECK", addIdx) + 1) + 1);
  for (const outcome of ["target", "stop", "open", "ambiguous", "pending", "unfilled"]) {
    assert.ok(stmt.includes(`'${outcome}'`), `outcome CHECK must allow '${outcome}' — got: ${stmt}`);
  }
  // And the fix ordering that makes the DROP+ADD meaningful: it must run AFTER the
  // CREATE TABLE whose inline column CHECK (auto-named the same) lacks 'unfilled'.
  assert.ok(
    addIdx > src.indexOf("CREATE TABLE IF NOT EXISTS nighthawk_play_outcomes"),
    "the re-issue must follow the table DDL it upgrades"
  );
});

test("ensureSchema: the api_telemetry seq bootstrap is forward-only, never an unconditional rewind", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");

  // REGRESSION GUARD (live: 24 dropped telemetry rows, 2026-07-29..08-06). The bootstrap must
  // never rewind api_telemetry_events_seq_id_seq: an unconditional setval to MAX(seq_id)+1 races
  // every OTHER running task's uncommitted nextval and re-issues a seq_id that is already taken,
  // which violates api_telemetry_events_pkey. The INSERT's ON CONFLICT covers only the event_id
  // UNIQUE index, so the losing row is lost, not deduped.
  const bootstrap = src.slice(
    src.indexOf("CREATE SEQUENCE IF NOT EXISTS api_telemetry_events_seq_id_seq"),
    src.indexOf("CREATE TABLE IF NOT EXISTS admin_audit_log")
  );
  assert.ok(bootstrap.length > 0, "api_telemetry seq bootstrap block not found");

  assert.equal(
    (bootstrap.match(/PERFORM setval\(/g) ?? []).length,
    1,
    "exactly one setval on the telemetry sequence"
  );
  assert.ok(
    !/SELECT\s+setval\(/.test(bootstrap),
    "a bare top-level `SELECT setval(...)` is the unguarded form this test exists to keep out"
  );
  assert.match(
    bootstrap,
    /IF\s+next_val\s*<=\s*max_id\s+THEN/,
    "the setval must be guarded by 'sequence is behind the table' — an unguarded setval is the bug"
  );
  // The guard is only sound if next_val accounts for is_called: a freshly-consumed sequence has
  // last_value == the value already handed out, so the NEXT value is last_value + 1.
  assert.match(
    bootstrap,
    /CASE\s+WHEN\s+is_called\s+THEN\s+last_value\s*\+\s*1\s+ELSE\s+last_value\s+END/,
    "next_val must be derived from last_value/is_called, not last_value alone"
  );
});

test("persistApiTelemetryEvent: never supplies seq_id — the PRIMARY KEY is the sequence's to assign", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./api-telemetry-persist.ts", import.meta.url)),
    "utf8"
  );
  const insert = src.slice(src.indexOf("INSERT INTO api_telemetry_events"), src.indexOf("ON CONFLICT"));
  assert.ok(insert.length > 0, "telemetry INSERT not found");
  assert.ok(
    !/\bseq_id\b/.test(insert),
    "an app-assigned seq_id would reintroduce the legacy collision this migration exists to retire"
  );
});

// FINDINGS 2026-08-11 (P1, manufactured outcome): `last_mark = COALESCE($4, last_mark)` is
// correct on its own — a stale tick must never discard a good mark — but it makes "no quote was
// EVER seen" indistinguishable from "quoted, and it equals entry". A row is seeded with its entry
// premium, so a contract whose quote never arrives keeps showing entry forever, reports P&L of
// exactly 0.00%, and CLOSES as a breakeven. That happened live: RIOT held 0.93 for 77 minutes and
// graded breakeven while the contract traded 0.24 -> 1.48 (76 of 84 minute bars >$0.05 away).
// A manufactured breakeven is not neutral — it enters the record as a non-loss, flattering win
// rate AND withholding a real outcome from calibration.
// The stamp must be CONDITIONAL: writing it unconditionally would say "observed just now" on
// precisely the ticks where nothing was observed, i.e. re-create the bug in a new column.
test("both live-state writers stamp last_mark_at ONLY when a real mark arrives", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");

  // The column has to exist before either writer can stamp it.
  assert.match(src, /ADD COLUMN IF NOT EXISTS last_mark_at TIMESTAMPTZ/);

  // Writer 1: the 0DTE live-marks / cron-sync lane ($4 is the mark).
  const zStart = src.indexOf("export async function updateZeroDteLiveState");
  assert.ok(zStart > 0, "updateZeroDteLiveState exists");
  const zBody = src.slice(zStart, src.indexOf("stampZeroDteExitContext"));
  assert.match(
    zBody,
    /last_mark_at = CASE\s*\n\s*WHEN status = 'CLOSED' THEN last_mark_at\s*\n\s*WHEN \$4 IS NOT NULL THEN now\(\)\s*\n\s*ELSE last_mark_at\s*\n\s*END/
  );
  // The COALESCE it disambiguates must still be there — the stamp ADDS a fact, it does not
  // change which marks are kept (for an OPEN/HOLD/TRIM row; see the CLOSED-freeze test below).
  assert.match(zBody, /last_mark = CASE WHEN status = 'CLOSED' THEN last_mark ELSE COALESCE\(\$4, last_mark\) END/);

  // Writer 2: the swing/other ledger lane ($3 is the mark). Both writers or neither — a row
  // updated only by the unstamped one would be indistinguishable from a never-quoted row.
  assert.match(src, /last_mark_at = CASE WHEN \$3 IS NOT NULL THEN now\(\) ELSE last_mark_at END/);
});

// BUG FIX (2026-08-27, live evidence: MSTR closed "thesis" at a real exit_pnl_pct of +1.61%
// but the board displayed live_pnl_pct -3.23%): the status CASE above was already terminal at
// CLOSED, but last_mark/peak_premium/trough_premium were NOT — the ~1s live-marks poller's
// 10s-stale active-set cache (ACTIVE_SET_TTL_MS, live-marks.ts) can still believe a just-closed
// row is OPEN/HOLD for up to that window and heartbeat-persists a fresh quote into it anyway.
// reconcileLedgerLivePnlPct (marks-math.ts) reads last_mark directly for every closed_reason
// other than "stopped"/condor, so the member-visible "realized" P&L kept drifting — and could
// flip sign — for several seconds after the trade was actually decided. All four mark-anchored
// columns must freeze the instant the row's OWN pre-update status is already CLOSED.
test("updateZeroDteLiveState: last_mark/last_mark_at/peak_premium/trough_premium all freeze once status is already CLOSED", () => {
  const src = readFileSync(fileURLToPath(new URL("./db.ts", import.meta.url)), "utf8");
  const start = src.indexOf("export async function updateZeroDteLiveState");
  assert.ok(start > 0, "updateZeroDteLiveState exists");
  const body = src.slice(start, src.indexOf("stampZeroDteExitContext"));
  assert.match(body, /last_mark = CASE WHEN status = 'CLOSED' THEN last_mark ELSE COALESCE\(\$4, last_mark\) END/);
  assert.match(body, /WHEN status = 'CLOSED' THEN last_mark_at/);
  assert.match(body, /WHEN status = 'CLOSED' THEN peak_premium/);
  assert.match(body, /WHEN status = 'CLOSED' THEN trough_premium/);
});
