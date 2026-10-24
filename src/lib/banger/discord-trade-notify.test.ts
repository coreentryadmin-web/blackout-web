import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bangerChiefTradeChannelId,
  bangerDiscordAlertsEnabled,
  bangerInputFromInsert,
  buildBangerTradePayload,
  type BangerTradeDiscordInput,
} from "./discord-trade-notify";
import type { BangerPositionRow } from "./positions-db";

/** Test-only fixture mapper — the production equivalent (`bangerInputFromRow`) was removed as
 *  dead code (2026-10-11, zero real callers; `live-sync.ts` hand-builds this same shape inline
 *  with its own live-mark override instead of calling it). */
function inputFromRow(row: BangerPositionRow): BangerTradeDiscordInput | null {
  const premium = row.entry_premium;
  if (premium == null || !Number.isFinite(premium) || premium <= 0) return null;
  return {
    session_date: row.session_date,
    position_id: row.id,
    ticker: row.ticker.toUpperCase(),
    contract_strike: row.contract_strike,
    contract_expiry: row.contract_expiry,
    entry_premium: premium,
    last_mark: row.last_mark,
    scaled_already: row.scaled_already,
  };
}

function sampleRow(overrides: Partial<BangerPositionRow> = {}): BangerPositionRow {
  return {
    id: 7,
    commit_key: "2026-09-05:NVDA:2026-09-12:5",
    session_date: "2026-09-05",
    ticker: "NVDA",
    discovery_gain: 0.12,
    discovery_vol: 1_000_000,
    discovery_dollar_vol: 50_000_000,
    discovery_close_strength: 0.8,
    contract_strike: 140,
    contract_expiry: "2026-09-12",
    contract_occ: "NVDA260912C00140000",
    entry_premium: 0.85,
    last_mark: 1.7,
    last_mark_at: "2026-09-05T20:20:00.000Z",
    peak_premium: 1.9,
    scaled_already: false,
    scale_out_action: null,
    scale_out_reason: null,
    partial_realized_premium: null,
    realized_pnl_pct: null,
    realized_pnl_usd: null,
    entry_context: null,
    status: "OPEN",
    first_seen_at: "2026-09-05T20:20:00.000Z",
    committed_at: "2026-09-05T20:20:00.000Z",
    closed_at: null,
    updated_at: "2026-09-05T20:20:00.000Z",
    ...overrides,
  };
}

describe("banger discord-trade-notify", () => {
  test("bangerDiscordAlertsEnabled respects BANGER_DISCORD_ALERTS", () => {
    const prev = process.env.BANGER_DISCORD_ALERTS;
    process.env.BANGER_DISCORD_ALERTS = "1";
    assert.equal(bangerDiscordAlertsEnabled(), true);
    process.env.BANGER_DISCORD_ALERTS = "0";
    assert.equal(bangerDiscordAlertsEnabled(), false);
    if (prev === undefined) delete process.env.BANGER_DISCORD_ALERTS;
    else process.env.BANGER_DISCORD_ALERTS = prev;
  });

  test("bangerInputFromInsert maps commit insert", () => {
    const input = bangerInputFromInsert(12, {
      commit_key: "k",
      session_date: "2026-09-05",
      ticker: "TSLA",
      contract_strike: 300,
      contract_expiry: "2026-09-19",
      contract_occ: "OCC",
      entry_premium: 1.2,
    });
    assert.equal(input?.position_id, 12);
    assert.equal(input?.ticker, "TSLA");
  });

  test("buildBangerTradePayload includes banger channel when configured", () => {
    const prevCh = process.env.BANGER_CHIEF_TRADE_CHANNEL_ID;
    const prevAuth = process.env.BANGER_DISCORD_AUTHOR_NAME;
    process.env.BANGER_CHIEF_TRADE_CHANNEL_ID = "9876543210";
    process.env.BANGER_DISCORD_AUTHOR_NAME = "banger-bot";
    try {
      const input = inputFromRow(sampleRow())!;
      const payload = buildBangerTradePayload(input, "BTO", 0.85, { idempotencySuffix: "bto" });
      assert.equal(payload?.strike, "140C");
      assert.equal(payload?.expiry, "9/12");
      assert.equal(payload?.channel_id, "9876543210");
      assert.equal(payload?.author_name, "banger-bot");
      assert.equal(payload?.idempotency_key, "banger:7:bto");
      assert.equal(bangerChiefTradeChannelId(), "9876543210");
    } finally {
      if (prevCh === undefined) delete process.env.BANGER_CHIEF_TRADE_CHANNEL_ID;
      else process.env.BANGER_CHIEF_TRADE_CHANNEL_ID = prevCh;
      if (prevAuth === undefined) delete process.env.BANGER_DISCORD_AUTHOR_NAME;
      else process.env.BANGER_DISCORD_AUTHOR_NAME = prevAuth;
    }
  });

  test("buildBangerTradePayload partial STC uses position-scoped idempotency suffix", () => {
    const input = inputFromRow(sampleRow())!;
    const payload = buildBangerTradePayload(input, "STC", 1.7, {
      qty: 1,
      idempotencySuffix: "partial",
    });
    assert.equal(payload?.action, "STC");
    assert.equal(payload?.idempotency_key, "banger:7:partial");
  });
});
