import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  deriveLegacyPlanAction,
  hydrateLegacyLiveSyncRow,
  runLegacyLiveSync,
  type LegacyLiveSyncRow,
} from "./legacy-live-sync.ts";
import type { LegacyDiscordLiveRow } from "@/lib/db";

function baseRow(overrides: Partial<LegacyDiscordLiveRow> = {}): LegacyDiscordLiveRow {
  return {
    id: 1,
    edition_for: "2026-09-02",
    ticker: "NVDA",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 180,
    entry_range_high: 185,
    target: 200,
    stop: 170,
    score: 90,
    sector: "tech",
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "pending",
    created_at: new Date().toISOString(),
    contract_occ: "NVDA260919C00180000",
    entry_premium: 4,
    exit_style: null,
    options_play: "NVDA $180 CALL @ $4.00 — Sep 19",
    ...overrides,
  };
}

describe("legacy-live-sync", () => {
  test("deriveLegacyPlanAction HOLDs between stop and target", () => {
    const row = hydrateLegacyLiveSyncRow(baseRow());
    const action = deriveLegacyPlanAction({ row, mark: 5, stockPrice: 185 });
    assert.equal(action.kind, "HOLD");
  });

  test("deriveLegacyPlanAction CLOSEs on premium hard stop", () => {
    const row = hydrateLegacyLiveSyncRow(baseRow());
    const action = deriveLegacyPlanAction({ row, mark: 1.9, stockPrice: 185 });
    assert.equal(action.kind, "CLOSE");
  });

  test("deriveLegacyPlanAction TRIMs at +100% premium", () => {
    const row = hydrateLegacyLiveSyncRow(baseRow());
    const action = deriveLegacyPlanAction({ row, mark: 8.1, stockPrice: 185 });
    assert.equal(action.kind, "TRIM");
  });

  test("deriveLegacyPlanAction CLOSEs on stock stop", () => {
    const row = hydrateLegacyLiveSyncRow(baseRow());
    const action = deriveLegacyPlanAction({ row, mark: 3.5, stockPrice: 169 });
    assert.equal(action.kind, "CLOSE");
  });

  test("deriveLegacyPlanAction TRIMs on stock target once", () => {
    const row = hydrateLegacyLiveSyncRow(baseRow());
    const action = deriveLegacyPlanAction({ row, mark: 5, stockPrice: 201 });
    assert.equal(action.kind, "TRIM");
  });

  // ── 2026-09-16: troughOut skipped the entry_premium floor peakOut already applies ──────────
  //
  // peakOut floors at entry_premium via `row.peak_premium ?? row.entry_premium` before taking
  // Math.max — a row whose peak_premium hasn't been seeded yet still can't report a peak below
  // its own entry. troughOut used a bare ternary instead (`row.trough_premium != null ? ... :
  // mark`), which on an unseeded row just returned the raw mark with no floor at all. On a
  // favorable first tick (mark > entry_premium) that recorded a trough HIGHER than the true
  // lowest-ever-observed premium (entry_premium itself), understating the real drawdown range.

  test("runLegacyLiveSync floors troughOut at entry_premium the same way peakOut does", async () => {
    process.env.LEGACY_DISCORD_ALERTS = "1";
    try {
      const row: LegacyLiveSyncRow = {
        ...baseRow(),
        peak_premium: null,
        trough_premium: null,
        trims_taken: 0,
        scaled_already: false,
        discord_live_state: { bto_posted: true },
      };

      const updates: Array<{ id: number; update: Record<string, unknown> }> = [];
      const result = await runLegacyLiveSync({
        fetchOpenRows: async () => [row],
        fetchOptionMarks: async () => new Map([[row.contract_occ, 5]]), // mark=5 > entry_premium=4
        fetchStockPrices: async () => new Map([[row.ticker, 185]]), // stays within HOLD band
        updateLiveState: async (id, update) => {
          updates.push({ id, update });
        },
      });

      assert.equal(result.ok, true);
      const holdUpdate = updates.find((u) => u.update.lastAction === "HOLD");
      assert.ok(holdUpdate, "expected a HOLD update for a row within plan bands");
      assert.equal(holdUpdate!.update.peakPremium, 5, "peak = max(entry_premium=4, mark=5) = 5");
      assert.equal(
        holdUpdate!.update.troughPremium,
        4,
        "trough = min(entry_premium=4, mark=5) = 4 — the true floor, not the raw mark"
      );
    } finally {
      delete process.env.LEGACY_DISCORD_ALERTS;
    }
  });
});
