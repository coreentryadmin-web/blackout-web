import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSwingPositionMark } from "./swing-healthcheck-mark-eval.mjs";

test("resolveSwingPositionMark reads the REAL schema — contract.mid + markAsOf", () => {
  // This is the actual shape GET /api/market/nighthawk/horizons?view=SWING serves for a
  // live MANAGING/SCALING_OUT position (captured live 2026-09-11, NRG position 34).
  const real = {
    ticker: "NRG",
    status: "COMMIT",
    contract: { mid: 5.55, bid: 4.7, ask: 6.4 },
    markAsOf: "2026-09-11T14:30:53.573Z",
    livePnlPct: 13.3,
  };
  const { mark, markTs } = resolveSwingPositionMark(real);
  assert.equal(mark, 5.55);
  assert.equal(markTs, "2026-09-11T14:30:53.573Z");
});

test("resolveSwingPositionMark falls back to legacy flat field names if ever present", () => {
  const legacyShaped = { mark: 3.2, mark_ts: "2026-09-11T10:00:00.000Z" };
  const { mark, markTs } = resolveSwingPositionMark(legacyShaped);
  assert.equal(mark, 3.2);
  assert.equal(markTs, "2026-09-11T10:00:00.000Z");
});

test("resolveSwingPositionMark reports genuinely null when neither shape has a mark", () => {
  const empty = { ticker: "XYZ", status: "COMMIT" };
  const { mark, markTs } = resolveSwingPositionMark(empty);
  assert.equal(mark, null);
  assert.equal(markTs, null);
});

test("resolveSwingPositionMark prefers contract.mid over a legacy flat mark if both present", () => {
  const both = { contract: { mid: 9.9 }, mark: 1.1, markAsOf: "2026-09-11T00:00:00.000Z" };
  const { mark } = resolveSwingPositionMark(both);
  assert.equal(mark, 9.9);
});
