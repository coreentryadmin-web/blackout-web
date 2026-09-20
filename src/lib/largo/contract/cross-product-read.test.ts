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
  assert.equal(read.coverage.label, "2/7 products reporting");
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

test("agreement always states its coverage — two agreeing is not six agreeing", async () => {
  const read = await crossProductRead(
    "SPX",
    exec({
      get_helix_tape_analytics: { ticker: "SPX", session: { call_pct: 80, alert_count: 40 } },
      get_zerodte_plays: { ticker: "SPX", plays: [{ ticker: "SPX", option_type: "CALL" }] },
    }),
    NOW
  );
  assert.equal(read.verdict, "aligned");
  assert.equal(read.coverage.label, "2/7 products reporting");
  assert.match(read.reading_note, /an agreement among two is not an agreement among six/);
});

test("everything down is insufficient, with six distinct reasons and no verdict", async () => {
  const read = await crossProductRead("SPX", exec({}), NOW);
  assert.equal(read.verdict, "insufficient");
  assert.equal(read.direction, null);
  assert.equal(read.missing.length, 7);
  for (const m of read.missing) assert.ok(m.reason.length > 0);
  assert.match(read.reading_note, /Too few products reported/);
});

test("non-SPX tickers count SPX Slayer as an explained absence without calling get_spx_play", async () => {
  const calls: string[] = [];
  const read = await crossProductRead(
    "NVDA",
    async (name) => {
      calls.push(name);
      return null;
    },
    NOW
  );
  assert.ok(!calls.includes("get_spx_play"));
  const spx = read.missing.find((m) => m.product === "spx");
  assert.match(String(spx?.reason), /only tracks SPX\/SPXW/);
  assert.equal(read.missing.length, 7);
});

test("an empty ticker falls back to SPX rather than reading nothing", async () => {
  const read = await crossProductRead("", exec({}), NOW);
  assert.equal(read.ticker, "SPX");
});

test("BUG FIX 2026-09-20 — Night Hawk Swings is fanned out and can cast a real vote (was missing entirely)", async () => {
  // Before this fix, `get_swing_play_brief` was never called at all — Swing had no ProductId, no
  // adapter, and no SOURCES entry, so a member asking "where do the desks disagree on NVDA" could
  // never learn Swing's own stance or see it contribute to a split, even with an open Swing
  // position on that exact ticker. This proves it now reports, votes, and is NAMED correctly when
  // it dissents from the rest of the desk.
  const read = await crossProductRead(
    "NVDA",
    exec({
      get_helix_tape_analytics: { ticker: "NVDA", session: { call_pct: 20, alert_count: 60 } },
      get_zerodte_plays: { ticker: "NVDA", plays: [{ ticker: "NVDA", option_type: "PUT" }] },
      get_swing_play_brief: {
        available: true,
        ticker: "NVDA",
        engine: "swing_play_intelligence",
        envelope: { bias: "bullish", headline: "HOLD — NVDA 950C 2026-10-16" },
      },
    }),
    NOW
  );
  assert.ok(read.reporting.includes("swing"), "swing must be able to report at all");
  assert.equal(read.verdict, "split");
  const bullCamp = read.camps.find((c) => c.direction === "bullish");
  assert.ok(bullCamp?.products.includes("swing"));
  assert.ok(bullCamp?.evidence.some((e) => e.startsWith("swing: ")), "evidence must be attributed to swing");
});
