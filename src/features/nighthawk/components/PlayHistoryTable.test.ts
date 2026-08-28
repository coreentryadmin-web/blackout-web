import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayHistoryTable } from "./PlayHistoryTable";
import type { ZeroDteRecordPlay } from "@/lib/zerodte/record";

(globalThis as unknown as { React: typeof React }).React = React;

const PLAYS: ZeroDteRecordPlay[] = [
  {
    session_date: "2026-08-28",
    ticker: "NVDA",
    direction: "long",
    flagged_at: "2026-08-28T14:35:00.000Z",
    flagged_et: "10:35 ET",
    score: 82,
    conviction: "high",
    plan_outcome: "doubled",
    plan_pnl_pct: 100,
    managed_outcome: "doubled",
    managed_pnl_pct: 84.2,
    managed_source: "engine",
    direction_hit: true,
    move_pct: 3.1,
    entry_context: null,
    tier: "A",
  },
  {
    session_date: "2026-08-27",
    ticker: "TSLA",
    direction: "short",
    flagged_at: "2026-08-27T15:10:00.000Z",
    flagged_et: "11:10 ET",
    score: 61,
    conviction: null,
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    managed_outcome: "stopped",
    managed_pnl_pct: -48.5,
    managed_source: "plan",
    direction_hit: false,
    move_pct: -1.2,
    entry_context: null,
    tier: "B",
  },
];

function renderTable(plays: ZeroDteRecordPlay[] = PLAYS): string {
  return renderToStaticMarkup(
    React.createElement(PlayHistoryTable, { plays, windowDays: 30, onWindowDaysChange: () => {} })
  );
}

test("renders one row per play with date, ticker, direction, tier, and signed P&L", () => {
  const html = renderTable();

  assert.match(html, /2026-08-28/);
  assert.match(html, /NVDA/);
  assert.match(html, />L</, "long play should render an L direction chip");
  assert.match(html, />A</, "NVDA row should show its A tier");
  assert.match(html, /\+84\.2%/);

  assert.match(html, /2026-08-27/);
  assert.match(html, /TSLA/);
  assert.match(html, />S</, "short play should render an S direction chip");
  assert.match(html, /-48\.5%/);
});

test("humanizes the raw engine outcome codes rather than printing them verbatim", () => {
  const html = renderTable();
  assert.match(html, /doubled/);
  assert.match(html, /stopped/);
});

test("empty plays array renders the empty state, not an empty table", () => {
  const html = renderTable([]);
  assert.match(html, /No graded plays in the last 30d/);
  assert.doesNotMatch(html, /<table/);
});

test("window buttons render all three options with the current one marked active", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlayHistoryTable, { plays: PLAYS, windowDays: 90, onWindowDaysChange: () => {} })
  );
  assert.match(html, /aria-pressed="true"[^>]*>90d/);
  assert.match(html, />7d</);
  assert.match(html, />30d</);
});
