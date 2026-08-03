import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveEngineStatus, formatEngineUpdateAge } from "./deck-engine-status.ts";

const NOW = Date.parse("2026-08-03T12:00:00-04:00");

describe("deck-engine-status", () => {
  it("formatEngineUpdateAge uses sec granularity for fresh boards", () => {
    assert.equal(formatEngineUpdateAge("2026-08-03T11:59:58-04:00", NOW), "2 sec ago");
    assert.equal(formatEngineUpdateAge("2026-08-03T11:59:59.5-04:00", NOW), "just now");
  });

  it("deriveEngineStatus returns Monitoring during RTH with fresh board", () => {
    const s = deriveEngineStatus({
      degraded: false,
      loading: false,
      sessionHeat: "RTH",
      boardAsOf: "2026-08-03T11:59:58-04:00",
      nowMs: NOW,
    });
    assert.equal(s.mode, "monitoring");
    assert.equal(s.label, "Monitoring");
    assert.equal(s.ok, true);
    assert.equal(s.lastUpdateAge, "2 sec ago");
  });

  it("deriveEngineStatus returns Offline when degraded", () => {
    const s = deriveEngineStatus({
      degraded: true,
      loading: false,
      sessionHeat: "RTH",
      boardAsOf: "2026-08-03T11:59:58-04:00",
      nowMs: NOW,
    });
    assert.equal(s.mode, "offline");
    assert.equal(s.ok, false);
  });

  it("deriveEngineStatus returns Standby after session close", () => {
    const s = deriveEngineStatus({
      degraded: false,
      loading: false,
      sessionHeat: "CLOSED",
      boardAsOf: "2026-08-03T16:05:00-04:00",
      nowMs: NOW,
    });
    assert.equal(s.mode, "idle");
    assert.equal(s.label, "Standby");
    assert.equal(s.ok, true);
  });

  it("deriveEngineStatus returns Monitoring for legacy during pre-market window", () => {
    const s = deriveEngineStatus({
      degraded: false,
      loading: false,
      sessionHeat: "PRE_MARKET",
      boardAsOf: "2026-08-03T08:00:00-04:00",
      nowMs: NOW,
      etMinutes: 8 * 60,
      horizon: "LEGACY",
    });
    assert.equal(s.mode, "monitoring");
    assert.equal(s.label, "Monitoring");
  });

  it("deriveEngineStatus returns Syncing on first load", () => {
    const s = deriveEngineStatus({
      degraded: false,
      loading: true,
      sessionHeat: "RTH",
      boardAsOf: null,
      nowMs: NOW,
    });
    assert.equal(s.mode, "syncing");
    assert.equal(s.label, "Syncing");
  });
});
