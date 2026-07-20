import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import { HELIX_STRIKE_HITS_WINDOW_MS } from "./helix-strike-leaders";
import { selectTopPrints } from "./helix-top-prints";

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

test("selectTopPrints prefers score >= 5 when available", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: 8, premium: 1_000_000 }),
    row({ ticker: "QQQ", score: 3, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "score");
  assert.equal(rows[0]?.ticker, "SPY");
});

test("selectTopPrints falls back to premium when no high scores", () => {
  const { rows, mode } = selectTopPrints([
    row({ ticker: "SPY", score: 2, premium: 2_000_000 }),
    row({ ticker: "QQQ", score: 1, premium: 5_000_000 }),
  ]);
  assert.equal(mode, "premium");
  assert.equal(rows[0]?.ticker, "QQQ");
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
