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
