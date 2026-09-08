import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import { HELIX_STRIKE_HITS_WINDOW_MS } from "./helix-strike-leaders";
import { HELIX_TOP_PRINTS_MIN_SCORE, selectTopPrints } from "./helix-top-prints";

function row(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker">): FlowAlert {
  return {
    premium: 500_000,
    option_type: "CALL",
    strike: 100,
    expiry: "2026-07-20",
    alerted_at: "2026-07-17T15:00:00.000Z",
    event_at: "2026-07-17T15:00:00.000Z",
    score: 0,
    direction: "bullish",
    route: "stock",
    ...partial,
  } as FlowAlert;
}

test("selectTopPrints prefers score >= HELIX_TOP_PRINTS_MIN_SCORE when available", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: HELIX_TOP_PRINTS_MIN_SCORE + 8, premium: 1_000_000 }),
    row({ ticker: "QQQ", score: HELIX_TOP_PRINTS_MIN_SCORE - 5, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "score");
  assert.equal(rows[0]?.ticker, "SPY");
});

test("selectTopPrints falls back to premium when no high scores", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: HELIX_TOP_PRINTS_MIN_SCORE - 2, premium: 2_000_000 }),
    row({ ticker: "QQQ", score: HELIX_TOP_PRINTS_MIN_SCORE - 6, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "premium");
  assert.equal(rows[0]?.ticker, "QQQ");
});

test("a plain floor-premium alert (no sweep, no 0DTE) no longer clears the gate", () => {
  // Regression pin for the 2026-08-01 fix: at the $200K ingest floor with no sweep/0DTE bonus,
  // premPts alone = round(200_000/1_000_000*60) = 12, which must NOT clear MIN_SCORE (20).
  const { mode } = selectTopPrints([row({ ticker: "SPY", score: 12, premium: 200_000 })]);
  assert.equal(mode, "premium", "a floor-premium, unflagged alert should fail the score gate");
});

test("selectTopPrints prefers in-window prints over stale session whales", () => {
  const nowMs = Date.parse("2026-07-20T16:00:00.000Z");
  const { rows, sessionFallback } = selectTopPrints(
    [
      row({
        ticker: "AMD",
        score: 90,
        premium: 5_000_000,
        strike: 500,
        event_at: "2026-07-20T10:00:00.000Z",
        alerted_at: "2026-07-20T10:00:00.000Z",
      }),
      row({
        ticker: "AMD",
        score: 72,
        premium: 800_000,
        strike: 180,
        event_at: "2026-07-20T15:55:00.000Z",
        alerted_at: "2026-07-20T15:55:00.000Z",
      }),
    ],
    { nowMs, windowMs: HELIX_STRIKE_HITS_WINDOW_MS }
  );
  assert.equal(sessionFallback, false);
  assert.equal(rows[0]?.strike, 180, "recent 180C beats stale 500C whale");
});

test("a future-dated print does not count as in-window (must not falsely clear sessionFallback)", () => {
  // Garbage/skewed timestamp one year ahead of nowMs makes `nowMs - ms` negative, which the old
  // unguarded `<= windowMs` check let through as "in window" — inflating the ranked pool and
  // reporting sessionFallback=false when there is in fact no real recent print.
  const nowMs = Date.parse("2026-07-20T16:00:00.000Z");
  const futureAt = "2027-07-20T15:55:00.000Z";
  const { sessionFallback } = selectTopPrints(
    [row({ ticker: "TSLA", score: 90, premium: 5_000_000, event_at: futureAt, alerted_at: futureAt })],
    { nowMs, windowMs: HELIX_STRIKE_HITS_WINDOW_MS }
  );
  assert.equal(sessionFallback, true, "no real print is actually in-window, so this must fall back");
});
