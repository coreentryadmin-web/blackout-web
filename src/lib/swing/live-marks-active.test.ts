import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSwingActivePlays, swingRowToActivePlay, bangerRowToActivePlay } from "./live-marks-active.ts";
import type { ActiveZeroDtePlay } from "@/lib/zerodte/live-marks";
import type { SwingPositionRow } from "@/lib/db";
import type { BangerPositionRow } from "@/lib/banger/positions-db";

const play = (occ: string, ticker: string): ActiveZeroDtePlay => ({
  session_date: "2026-09-04",
  ticker,
  direction: "long",
  strike: 100,
  occ,
  entry_premium: 2,
  status: "OPEN",
  peak_premium: null,
  trough_premium: null,
});

test("mergeSwingActivePlays: 0DTE entered rows win cap priority, then swing OCCs", () => {
  const merged = mergeSwingActivePlays([play("O:AAA", "AAA")], [play("O:BBB", "BBB")], 2);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.ticker, "AAA");
  assert.equal(merged[1]!.ticker, "BBB");
});

test("mergeSwingActivePlays: dedupes duplicate OCCs", () => {
  const merged = mergeSwingActivePlays([play("O:AAA", "AAA")], [play("O:AAA", "AAA")], 3);
  assert.equal(merged.length, 1);
});

// ---------------------------------------------------------------------------
// 2026-09-11 finding: swing/banger zombie-OCC guard (correction/follow-up to
// #4790, which only fixed zerodte/live-marks.ts's own toActivePlay() and never
// touched this file's row-builders — live evidence: 14 rows with expired OCCs
// still served mark:null/source:"none" from GET /api/market/zerodte/marks
// AFTER #4790 was confirmed deployed to production).
// ---------------------------------------------------------------------------

const swingRow = (over: Partial<SwingPositionRow> = {}): SwingPositionRow => ({
  id: 1,
  commit_key: "2026-08-21:OKTA:BREAKOUT:STANDARD:long",
  root_position_id: null,
  parent_position_id: null,
  roll_seq: 0,
  session_date: "2026-08-21",
  ticker: "OKTA",
  direction: "long",
  sub_lane: "STANDARD",
  archetype: "BREAKOUT",
  top_flow_strike: null,
  contract_strike: 140,
  contract_expiry: "2026-09-04",
  contract_type: "call",
  contract_occ: "OKTA260904C00140000",
  contract_delta: 0.5,
  entry_underlying_px: 135,
  thesis_invalidation_px: 125,
  target_underlying_px: 150,
  entry_premium: 5.97,
  last_mark: null,
  last_mark_at: null,
  peak_premium: null,
  trough_premium: null,
  underlying_mfe: null,
  underlying_mae: null,
  realized_pnl_pct: null,
  entry_context: {},
  gate_calibration_json: {},
  feature_vector: {},
  plan_json: null,
  scale_out_grade: null,
  grade_json: null,
  grade_methodology: null,
  legacy_grade: null,
  status: "TRIM",
  first_seen_at: "2026-08-21T14:00:00.000Z",
  committed_at: "2026-08-21T14:00:00.000Z",
  closed_at: null,
  graded_at: null,
  updated_at: "2026-08-21T14:00:00.000Z",
  ...over,
});

const bangerRow = (over: Partial<BangerPositionRow> = {}): BangerPositionRow => ({
  id: 1,
  commit_key: "2026-08-21:MSTR:BANGER",
  session_date: "2026-08-21",
  ticker: "MSTR",
  discovery_gain: null,
  discovery_vol: null,
  discovery_dollar_vol: null,
  discovery_close_strength: null,
  contract_strike: 110,
  contract_expiry: "2026-08-28",
  contract_occ: "MSTR260828C00110000",
  entry_premium: 3.2,
  last_mark: null,
  last_mark_at: null,
  peak_premium: null,
  scaled_already: false,
  scale_out_action: null,
  scale_out_reason: null,
  partial_realized_premium: null,
  realized_pnl_pct: null,
  realized_pnl_usd: null,
  entry_context: {},
  status: "OPEN",
  first_seen_at: "2026-08-21T14:00:00.000Z",
  committed_at: "2026-08-21T14:00:00.000Z",
  closed_at: null,
  updated_at: "2026-08-21T14:00:00.000Z",
  ...over,
});

test("swingRowToActivePlay: a TRIM row whose OCC expired weeks ago is EXCLUDED (zombie), not tracked with a dead contract", () => {
  // Same repro shape as the live 2026-09-11 finding: TODAY (2026-09-11) is well past
  // the OCC's real 2026-09-04 expiry, but the row's own session_date (its entry date,
  // 2026-08-21) is neither CLOSED nor equal to the expiry — the 0DTE-only
  // session_date==expiry guard (toActivePlay) does not and must not apply here.
  const p = swingRowToActivePlay(swingRow(), "2026-09-11");
  assert.equal(p, null);
});

test("swingRowToActivePlay: a healthy multi-week-out OPEN swing position (expiry weeks in the FUTURE) is still tracked", () => {
  const p = swingRowToActivePlay(swingRow({ contract_expiry: "2026-10-16", contract_occ: "OKTA261016C00140000", status: "OPEN" }), "2026-09-11");
  assert.notEqual(p, null);
  assert.equal(p!.occ, "O:OKTA261016C00140000");
});

test("swingRowToActivePlay: a position expiring TODAY is still tracked (not yet past its own expiry day)", () => {
  const p = swingRowToActivePlay(swingRow({ contract_expiry: "2026-09-11", contract_occ: "OKTA260911C00140000" }), "2026-09-11");
  assert.notEqual(p, null);
});

test("bangerRowToActivePlay: an OPEN banger row whose OCC expired weeks ago is EXCLUDED (same zombie class as swing)", () => {
  const p = bangerRowToActivePlay(bangerRow(), "2026-09-11");
  assert.equal(p, null);
});

test("bangerRowToActivePlay: a healthy still-live banger row is unaffected", () => {
  const p = bangerRowToActivePlay(bangerRow({ contract_expiry: "2026-10-02", contract_occ: "MSTR261002C00110000" }), "2026-09-11");
  assert.notEqual(p, null);
});
