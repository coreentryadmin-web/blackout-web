import assert from "node:assert/strict";
import { test } from "node:test";
import { regimeContextFromPersistedMarket, buildPostureBacktestReport } from "./posture-backtest";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";

type Row = Pick<NighthawkPlayOutcomeRow, "edition_for" | "direction" | "publish_context">;

function row(overrides: Partial<Row> = {}): Row {
  return {
    edition_for: "2026-09-15",
    direction: "LONG",
    publish_context: null,
    ...overrides,
  };
}

function marketBlock(overrides: Record<string, unknown> = {}) {
  return {
    market: {
      composite_regime: null,
      tide_bias: "NEUTRAL",
      breadth: { pct_advancing: 50 },
      ...overrides,
    },
  };
}

test("regimeContextFromPersistedMarket: null market -> null (never fabricated)", () => {
  assert.equal(regimeContextFromPersistedMarket(null), null);
  assert.equal(regimeContextFromPersistedMarket(undefined), null);
});

test("regimeContextFromPersistedMarket: maps breadth.pct_advancing -> advance_pct", () => {
  const ctx = regimeContextFromPersistedMarket({ breadth: { pct_advancing: 22 } });
  assert.equal(ctx!.advance_pct, 22);
});

test("regimeContextFromPersistedMarket: missing breadth reads advance_pct as null, not 0", () => {
  const ctx = regimeContextFromPersistedMarket({ tide_bias: "BEARISH" });
  assert.equal(ctx!.advance_pct, null);
  assert.equal(ctx!.tide_bias, "BEARISH");
});

test("regimeContextFromPersistedMarket: an invalid/unrecognized tide_bias value falls back to NEUTRAL, never crashes", () => {
  const ctx = regimeContextFromPersistedMarket({ tide_bias: "garbage" });
  assert.equal(ctx!.tide_bias, "NEUTRAL");
});

test("buildPostureBacktestReport: groups by edition_for, one regime read per session not per play", () => {
  const rows: Row[] = [
    row({ edition_for: "2026-09-15", direction: "LONG", publish_context: marketBlock() }),
    row({ edition_for: "2026-09-15", direction: "LONG", publish_context: marketBlock() }),
    row({ edition_for: "2026-09-16", direction: "SHORT", publish_context: marketBlock() }),
  ];
  const report = buildPostureBacktestReport(rows);
  assert.equal(report.sessions.length, 2);
  assert.equal(report.sessions[0]!.edition_for, "2026-09-15");
  assert.equal(report.sessions[0]!.published_long, 2);
  assert.equal(report.sessions[1]!.published_short, 1);
});

test("buildPostureBacktestReport: a genuinely bearish pin (2-of-3 signals) reads gate_posture SHORT", () => {
  const rows: Row[] = [
    row({
      edition_for: "2026-09-15",
      direction: "LONG",
      publish_context: marketBlock({ tide_bias: "BEARISH", breadth: { pct_advancing: 20 } }),
    }),
  ];
  const report = buildPostureBacktestReport(rows);
  assert.equal(report.sessions[0]!.gate_posture, "SHORT");
  assert.equal(report.sessions[0]!.gate_short_but_book_all_long, true, "gate said SHORT but the book stayed all-LONG");
});

test("buildPostureBacktestReport: a single bearish signal alone stays NEUTRAL (the deliberate 2-of-3 floor)", () => {
  const rows: Row[] = [
    row({
      edition_for: "2026-09-15",
      publish_context: marketBlock({ tide_bias: "BEARISH" }),
    }),
  ];
  const report = buildPostureBacktestReport(rows);
  assert.equal(report.sessions[0]!.gate_posture, "NEUTRAL");
});

test("buildPostureBacktestReport: a session with no publish_context on any row reports regime_unavailable, excluded from the fire-rate denominator", () => {
  const rows: Row[] = [
    row({ edition_for: "2026-09-10", publish_context: null }),
    row({ edition_for: "2026-09-11", publish_context: marketBlock() }),
  ];
  const report = buildPostureBacktestReport(rows);
  const missing = report.sessions.find((s) => s.edition_for === "2026-09-10")!;
  assert.equal(missing.regime_unavailable, true);
  assert.equal(missing.gate_posture, "NEUTRAL");
  assert.equal(report.summary.total_sessions, 2);
  assert.equal(report.summary.sessions_with_regime, 1, "the regime-less session must not count toward the denominator");
});

test("buildPostureBacktestReport: summary fire-rate is a percentage over sessions WITH a regime read, not all sessions", () => {
  const rows: Row[] = [
    row({ edition_for: "2026-09-10", publish_context: null }), // regime unavailable
    row({ edition_for: "2026-09-11", publish_context: marketBlock({ tide_bias: "BEARISH", breadth: { pct_advancing: 10 } }) }), // SHORT
    row({ edition_for: "2026-09-12", publish_context: marketBlock() }), // NEUTRAL
  ];
  const report = buildPostureBacktestReport(rows);
  assert.equal(report.summary.total_sessions, 3);
  assert.equal(report.summary.sessions_with_regime, 2);
  assert.equal(report.summary.gate_fired_short_n, 1);
  assert.equal(report.summary.gate_fired_short_pct, 50);
});

test("buildPostureBacktestReport: empty input yields an empty, non-crashing report", () => {
  const report = buildPostureBacktestReport([]);
  assert.deepEqual(report.sessions, []);
  assert.equal(report.summary.total_sessions, 0);
  assert.equal(report.summary.gate_fired_short_pct, null, "0/0 must read as null, never a fabricated 0%");
});

test("buildPostureBacktestReport: all_long_sessions_n counts sessions with >=1 published play, all of them LONG", () => {
  const rows: Row[] = [
    row({ edition_for: "2026-09-15", direction: "LONG", publish_context: marketBlock() }),
    row({ edition_for: "2026-09-16", direction: "SHORT", publish_context: marketBlock() }),
  ];
  const report = buildPostureBacktestReport(rows);
  assert.equal(report.summary.all_long_sessions_n, 1);
});
