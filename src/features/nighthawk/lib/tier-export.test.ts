import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNighthawkTierExportRow } from "./tier-export";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

function baseRow(overrides: Partial<NighthawkPlayOutcomeRow> = {}): NighthawkPlayOutcomeRow {
  return {
    id: 1,
    edition_for: "2026-09-15",
    ticker: "VNCE",
    direction: "LONG",
    conviction: "A",
    entry_range_low: 7.46,
    entry_range_high: 7.84,
    target: 8.41,
    stop: 6.64,
    score: 42,
    sector: "retail-apparel & accessory stores",
    next_day_open: null,
    next_day_close: null,
    session_high: null,
    session_low: null,
    hit_target: false,
    hit_stop: false,
    outcome: "pending",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test("buildNighthawkTierExportRow: carries the fields a score-calibration study needs, dropped by the aggregate record route", () => {
  const row = baseRow({ score: 42, conviction: "B", outcome: "target" });
  const exported = buildNighthawkTierExportRow(row);
  assert.equal(exported.edition_for, "2026-09-15");
  assert.equal(exported.ticker, "VNCE");
  assert.equal(exported.direction, "LONG");
  assert.equal(exported.conviction, "B");
  assert.equal(exported.score, 42);
  assert.equal(exported.outcome, "target");
});

test("buildNighthawkTierExportRow: a null score passes through unchanged (never fabricated as 0)", () => {
  const row = baseRow({ score: null });
  const exported = buildNighthawkTierExportRow(row);
  assert.equal(exported.score, null);
});

test("buildNighthawkTierExportRow: pulled defaults to false when the row omits it (pre-PR-N4 row)", () => {
  const row = baseRow();
  delete (row as { pulled?: boolean }).pulled;
  const exported = buildNighthawkTierExportRow(row);
  assert.equal(exported.pulled, false);
});

test("buildNighthawkTierExportRow: a pulled play's latch survives the export (a downstream study must exclude it, not silently count it decided)", () => {
  const row = baseRow({ outcome: "target", pulled: true, pulled_reason: "thesis break" });
  const exported = buildNighthawkTierExportRow(row);
  assert.equal(exported.pulled, true);
});
