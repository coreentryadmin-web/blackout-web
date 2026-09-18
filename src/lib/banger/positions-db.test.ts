import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBangerPositionRow } from "./positions-db.ts";

test("mapBangerPositionRow coerces numeric/jsonb columns and defaults status", () => {
  const row = mapBangerPositionRow({
    id: "42",
    commit_key: "2026-08-04:ANET:2026-08-14:105",
    session_date: "2026-08-04T00:00:00.000Z",
    ticker: "anet",
    discovery_gain: "0.25",
    discovery_vol: "2000000",
    discovery_dollar_vol: null,
    discovery_close_strength: "0.9",
    contract_strike: "105",
    contract_expiry: "2026-08-14T00:00:00.000Z",
    contract_occ: "O:ANET260814C00105000",
    entry_premium: "1.5",
    last_mark: "3.2",
    peak_premium: "3.4",
    scaled_already: true,
    scale_out_action: "TAKE_PARTIAL",
    scale_out_reason: "mark >= 2x entry",
    partial_realized_premium: "1.5",
    realized_pnl_pct: null,
    realized_pnl_usd: null,
    entry_context: { discovery: { screen: "banger" } },
    status: "PARTIAL",
    first_seen_at: "2026-08-04T13:30:00.000Z",
    committed_at: "2026-08-04T13:30:00.000Z",
    closed_at: null,
    updated_at: "2026-08-04T14:00:00.000Z",
  });
  assert.equal(row.id, 42);
  assert.equal(row.ticker, "ANET");
  assert.equal(row.discovery_gain, 0.25);
  assert.equal(row.discovery_dollar_vol, null);
  assert.equal(row.contract_strike, 105);
  assert.equal(row.entry_premium, 1.5);
  assert.equal(row.scaled_already, true);
  assert.equal(row.status, "PARTIAL");
  assert.deepEqual(row.entry_context, { discovery: { screen: "banger" } });
  assert.equal(row.closed_at, null);
  assert.equal(row.last_mark_at, null);
});

// FINDINGS 2026-09-11: banger_positions never had a per-mark timestamp column at all, so this
// field couldn't be tested before it existed. Confirms the mapper round-trips it like every other
// TIMESTAMPTZ column once the writer starts stamping it.
test("mapBangerPositionRow surfaces last_mark_at when the column carries a value", () => {
  const row = mapBangerPositionRow({
    id: "1",
    commit_key: "k",
    session_date: "2026-08-04",
    ticker: "T",
    contract_strike: "1",
    contract_expiry: "2026-08-14",
    contract_occ: "occ",
    entry_premium: "1",
    last_mark: "1.1",
    last_mark_at: "2026-08-04T15:00:00.000Z",
    status: "OPEN",
    first_seen_at: "2026-08-04T13:30:00.000Z",
    updated_at: "2026-08-04T14:00:00.000Z",
  });
  assert.equal(row.last_mark_at, "2026-08-04T15:00:00.000Z");
});

test("mapBangerPositionRow parses a JSON-string entry_context (raw driver shape)", () => {
  const row = mapBangerPositionRow({
    id: "1",
    commit_key: "k",
    session_date: "2026-08-04",
    ticker: "T",
    contract_strike: "1",
    contract_expiry: "2026-08-14",
    contract_occ: "occ",
    entry_premium: "1",
    scaled_already: false,
    entry_context: '{"a":1}',
    status: "OPEN",
    first_seen_at: "2026-08-04T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
  });
  assert.deepEqual(row.entry_context, { a: 1 });
});

// REGRESSION (production incident, 2026-09-08): mapBangerPositionRow's session_date/contract_expiry
// used `String(r.field).slice(0, 10)` — correct for an already-ISO string fixture (which is all the
// tests above ever passed) but wrong for what node-postgres ACTUALLY returns for a DATE column with
// no setTypeParser override in this repo: a raw JS `Date`. `String(date)` runs `Date.prototype.toString()`
// ("Wed Aug 19 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"), and slicing the first 10 chars
// yields "Wed Aug 19" — a year-less, weekday-first label. That garbled session_date then flowed,
// unchanged, through bangerRowToActivePlay (live-marks-active.ts) into the ~1s live-marks poller's
// updateZeroDteLiveState($1::date, ...) call, and Postgres threw `invalid input syntax for type date`
// on every tick for every open banger position — thousands of error_events rows in 15 minutes.
// isoDateString (db.ts), the helper already used everywhere else in this codebase for this exact
// class of bug (mapZeroDteLogRow, mapSwingPositionRow), handles a raw Date correctly.
test("REGRESSION: mapBangerPositionRow normalizes a raw pg Date session_date/contract_expiry to ISO, not toString().slice(0,10)", () => {
  const pgDate = new Date(Date.UTC(2026, 7, 19)); // "Wed Aug 19 2026" when .toString()'d
  // Precondition: this is the garbage the old `String(date).slice(0, 10)` code produced.
  assert.equal(String(pgDate).slice(0, 10), "Wed Aug 19");
  const row = mapBangerPositionRow({
    id: "1",
    commit_key: "k",
    session_date: pgDate,
    ticker: "T",
    contract_strike: "1",
    contract_expiry: pgDate,
    contract_occ: "occ",
    entry_premium: "1",
    scaled_already: false,
    entry_context: null,
    status: "OPEN",
    first_seen_at: pgDate,
    updated_at: pgDate,
  });
  assert.equal(row.session_date, "2026-08-19");
  assert.equal(row.contract_expiry, "2026-08-19");
  // The TIMESTAMPTZ twin (first_seen_at/updated_at) had the identical `String(Date)` bug.
  assert.equal(row.first_seen_at, pgDate.toISOString());
  assert.equal(row.updated_at, pgDate.toISOString());
});

test("mapBangerPositionRow defaults status to OPEN when the column is missing", () => {
  const row = mapBangerPositionRow({
    id: "1",
    commit_key: "k",
    session_date: "2026-08-04",
    ticker: "T",
    contract_strike: "1",
    contract_expiry: "2026-08-14",
    contract_occ: "occ",
    entry_premium: "1",
    scaled_already: false,
    entry_context: null,
    status: null,
    first_seen_at: "2026-08-04T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(row.status, "OPEN");
});
