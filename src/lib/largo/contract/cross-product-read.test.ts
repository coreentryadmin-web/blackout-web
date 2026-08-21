import { test } from "node:test";
import assert from "node:assert/strict";

import { crossProductRead, type ToolExecutor } from "./cross-product-read";

/** Fake executor: map tool name -> payload, or an Error to simulate a lane being down. */
function exec(map: Record<string, unknown>): ToolExecutor {
  return async (name) => {
    const v = map[name];
    if (v instanceof Error) throw v;
    return v ?? null;
  };
}

const NOW = Date.UTC(2026, 7, 21, 13, 31); // 2026-08-21 09:31 ET

test("a real split reports both camps and refuses to resolve it", async () => {
  const read = await crossProductRead(
    "I:SPX",
    exec({
      get_helix_tape_analytics: { ticker: "SPX", session: { call_pct: 71, alert_count: 140 } },
      get_zerodte_plays: { ticker: "SPX", plays: [{ ticker: "SPX", option_type: "PUT" }] },
      get_helix_thermal_compare: { thermal: { gamma_posture: "short", volatility_regime: "amplifying" } },
      get_vector_pulse: { ticker: "SPX", has_baseline: false, signals: [] },
      get_earnings: { events: [] },
    }),
    NOW
  );

  assert.equal(read.ticker, "SPX", "I:SPX folds to the canonical root");
  assert.equal(read.verdict, "split");
  assert.equal(read.direction, null);
  assert.equal(read.coverage.label, "2/5 products reporting");
  assert.match(read.reading_note, /Do not resolve the split/);
  assert.match(String(read.disagreement), /genuine disagreement/);
});

test("contract C1 — the payload carries an ET stamp and session date, not a UTC instant", async () => {
  const read = await crossProductRead("SPX", exec({}), NOW);
  assert.equal(read.as_of, "2026-08-21 09:31 ET");
  assert.equal(read.session_date, "2026-08-21");
});

test("a lane being DOWN degrades one product, never the whole read", async () => {
  const read = await crossProductRead(
    "SPX",
    exec({
      get_helix_tape_analytics: { ticker: "SPX", session: { call_pct: 80, alert_count: 40 } },
      get_vector_pulse: new Error("ECONNRESET talking to redis"),
      get_zerodte_plays: { ticker: "SPX", plays: [{ ticker: "SPX", option_type: "CALL" }] },
    }),
    NOW
  );
  assert.equal(read.verdict, "aligned");
  assert.equal(read.direction, "bullish");
  const vector = read.missing.find((m) => m.product === "vector");
  // The TOOL is named, because "vector unavailable" and "get_vector_pulse threw ECONNRESET" send
  // an operator to different places.
  assert.match(String(vector?.reason), /get_vector_pulse failed/);
  assert.match(String(vector?.reason), /ECONNRESET/);
});

test("agreement always states its coverage — two agreeing is not five agreeing", async () => {
  const read = await crossProductRead(
    "SPX",
    exec({
      get_helix_tape_analytics: { ticker: "SPX", session: { call_pct: 80, alert_count: 40 } },
      get_zerodte_plays: { ticker: "SPX", plays: [{ ticker: "SPX", option_type: "CALL" }] },
    }),
    NOW
  );
  assert.equal(read.verdict, "aligned");
  assert.equal(read.coverage.label, "2/5 products reporting");
  assert.match(read.reading_note, /an agreement among two is not an agreement among five/);
});

test("everything down is insufficient, with five distinct reasons and no verdict", async () => {
  const read = await crossProductRead("SPX", exec({}), NOW);
  assert.equal(read.verdict, "insufficient");
  assert.equal(read.direction, null);
  assert.equal(read.missing.length, 5);
  for (const m of read.missing) assert.ok(m.reason.length > 0);
  assert.match(read.reading_note, /Too few products reported/);
});

test("an empty ticker falls back to SPX rather than reading nothing", async () => {
  const read = await crossProductRead("", exec({}), NOW);
  assert.equal(read.ticker, "SPX");
});
