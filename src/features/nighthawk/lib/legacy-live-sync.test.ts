import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveLegacyPlanAction, hydrateLegacyLiveSyncRow } from "./legacy-live-sync.ts";
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
});
