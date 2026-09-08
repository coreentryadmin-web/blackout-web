import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildSwingTradePayload,
  swingChiefTradeChannelId,
  swingDiscordAlertsEnabled,
  swingInputFromInsert,
  swingInputFromRow,
} from "./discord-trade-notify";
import type { SwingPositionRow } from "@/lib/db";

function sampleRow(overrides: Partial<SwingPositionRow> = {}): SwingPositionRow {
  return {
    id: 42,
    commit_key: "2026-09-05:AAPL:swing:long",
    root_position_id: 42,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-09-05",
    ticker: "AAPL",
    direction: "long",
    sub_lane: "swing",
    archetype: "MOMENTUM",
    top_flow_strike: 200,
    contract_strike: 200,
    contract_expiry: "2026-10-17",
    contract_type: "call",
    contract_occ: "AAPL251017C00200000",
    contract_delta: 0.35,
    entry_underlying_px: 198,
    thesis_invalidation_px: 190,
    target_underlying_px: 220,
    entry_premium: 4.2,
    last_mark: 3.8,
    last_mark_at: null,
    peak_premium: 5.1,
    trough_premium: 3.2,
    underlying_mfe: 201,
    underlying_mae: 195,
    realized_pnl_pct: null,
    entry_context: null,
    gate_calibration_json: null,
    feature_vector: null,
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "OPEN",
    first_seen_at: "2026-09-05T14:00:00.000Z",
    committed_at: "2026-09-05T14:00:00.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-09-05T14:00:00.000Z",
    ...overrides,
  };
}

describe("swing discord-trade-notify", () => {
  test("swingDiscordAlertsEnabled respects SWING_DISCORD_ALERTS", () => {
    const prev = process.env.SWING_DISCORD_ALERTS;
    process.env.SWING_DISCORD_ALERTS = "1";
    assert.equal(swingDiscordAlertsEnabled(), true);
    process.env.SWING_DISCORD_ALERTS = "0";
    assert.equal(swingDiscordAlertsEnabled(), false);
    if (prev === undefined) delete process.env.SWING_DISCORD_ALERTS;
    else process.env.SWING_DISCORD_ALERTS = prev;
  });

  test("swingInputFromRow maps ledger row", () => {
    const input = swingInputFromRow(sampleRow());
    assert.equal(input?.ticker, "AAPL");
    assert.equal(input?.position_id, 42);
    assert.equal(input?.contract_strike, 200);
  });

  test("swingInputFromInsert maps commit insert", () => {
    const input = swingInputFromInsert(99, {
      commit_key: "k",
      session_date: "2026-09-05",
      ticker: "NVDA",
      direction: "short",
      sub_lane: "swing",
      contract_strike: 140,
      contract_expiry: "2026-11-21",
      entry_premium: 2.5,
    });
    assert.equal(input?.position_id, 99);
    assert.equal(input?.direction, "short");
  });

  test("buildSwingTradePayload includes swing channel when configured", () => {
    const prevCh = process.env.SWING_CHIEF_TRADE_CHANNEL_ID;
    const prevAuth = process.env.SWING_DISCORD_AUTHOR_NAME;
    process.env.SWING_CHIEF_TRADE_CHANNEL_ID = "1234567890";
    process.env.SWING_DISCORD_AUTHOR_NAME = "swing-bot";
    try {
      const input = swingInputFromRow(sampleRow())!;
      const payload = buildSwingTradePayload(input, "BTO", 4.2, { idempotencySuffix: "bto" });
      assert.equal(payload?.strike, "200C");
      assert.equal(payload?.expiry, "10/17");
      assert.equal(payload?.channel_id, "1234567890");
      assert.equal(payload?.author_name, "swing-bot");
      assert.equal(payload?.idempotency_key, "swing:42:bto");
      assert.equal(swingChiefTradeChannelId(), "1234567890");
    } finally {
      if (prevCh === undefined) delete process.env.SWING_CHIEF_TRADE_CHANNEL_ID;
      else process.env.SWING_CHIEF_TRADE_CHANNEL_ID = prevCh;
      if (prevAuth === undefined) delete process.env.SWING_DISCORD_AUTHOR_NAME;
      else process.env.SWING_DISCORD_AUTHOR_NAME = prevAuth;
    }
  });

  test("buildSwingTradePayload roll STC uses position-scoped idempotency suffix", () => {
    const input = swingInputFromRow(sampleRow({ roll_seq: 2 }))!;
    const payload = buildSwingTradePayload(input, "STC", 1.8, { idempotencySuffix: "roll:2:stc" });
    assert.equal(payload?.action, "STC");
    assert.equal(payload?.idempotency_key, "swing:42:roll:2:stc");
  });
});
