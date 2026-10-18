import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayHistoryTable, commitScoreFor } from "./PlayHistoryTable";
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

test("range dropdown trigger shows the current window's label and starts closed", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlayHistoryTable, { plays: PLAYS, windowDays: 90, onWindowDaysChange: () => {} })
  );
  assert.match(html, /nh-history-range-trigger/);
  assert.match(html, /Last 90 days/);
  assert.match(html, /aria-expanded="false"/);
  // The preset panel is unmounted (not just hidden) until the trigger is clicked — no
  // "Last 7 days"/"Last 30 days" option text should reach the first render.
  assert.doesNotMatch(html, /Last 7 days/);
  assert.doesNotMatch(html, /Last 30 days/);
});

test("range dropdown shows a distinct label per window size, all within the API's real 90-day cap", () => {
  for (const [days, label] of [
    [7, "Last 7 days"],
    [14, "Last 14 days"],
    [30, "Last 30 days"],
    [60, "Last 60 days"],
    [90, "Last 90 days"],
  ] as const) {
    const html = renderToStaticMarkup(
      React.createElement(PlayHistoryTable, { plays: PLAYS, windowDays: days, onWindowDaysChange: () => {} })
    );
    assert.match(html, new RegExp(label), `windowDays=${days} should show "${label}"`);
  }
});

test("renders direction and tier filter pills plus sortable Date/P&L column headers", () => {
  const html = renderTable();
  assert.match(html, />Long</);
  assert.match(html, />Short</);
  assert.match(html, />All tiers</);
  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.match(html, />C</);
  assert.match(html, /aria-sort="descending"[^>]*>\s*Date/, "date column sorts newest-first by default");
});

test("renders the calendar heat-strip with one cell per distinct session date", () => {
  const html = renderTable();
  assert.match(html, /Past sessions/);
  assert.match(html, /2 sessions/);
  assert.match(html, /nh-history-cal-cell is-up/, "NVDA's +84.2% day should render an up-toned cell");
  assert.match(html, /nh-history-cal-cell is-down/, "TSLA's -48.5% day should render a down-toned cell");
});

test("a session with plays but none graded yet still gets a calendar cell, toned flat", () => {
  const html = renderTable([
    {
      session_date: "2026-08-29",
      ticker: "SPY",
      direction: "long",
      flagged_at: "2026-08-29T14:35:00.000Z",
      flagged_et: "10:35 ET",
      score: 55,
      conviction: null,
      plan_outcome: null,
      plan_pnl_pct: null,
      managed_outcome: null,
      managed_pnl_pct: null,
      managed_source: null,
      direction_hit: null,
      move_pct: null,
      entry_context: null,
      tier: null,
    },
  ]);
  assert.match(html, /nh-history-cal-cell is-flat/);
});

test("rows render collapsed by default — no detail drawer content on first render", () => {
  const html = renderTable();
  assert.match(html, /aria-expanded="false"/, "rows start collapsed");
  assert.doesNotMatch(html, /Direction hit/, "the detail drawer content should not be in the initial DOM");
  assert.match(html, /nh-history-expand-caret/, "a clickable affordance should still be visible");
});

test("P&L cells use exactly the three tone classes — no magnitude ramp", () => {
  const html = renderTable();
  assert.match(html, /nh-history-col-num tabular-nums nh-history-pnl is-up/);
  assert.match(html, /nh-history-col-num tabular-nums nh-history-pnl is-down/);
  assert.doesNotMatch(html, /is-mid|is-weak|is-strong/, "no magnitude-graded tone classes should exist");
});

// Regression for the mobile-viewport finding: .nh-history-tablewrap is overflow-x-auto around
// a table with min-w-[440px] (globals.css), wider than a 430px phone's available card width.
// The overflow always eats the RIGHTMOST column first, so wherever P&L rendered used to decide
// whether it survived on a narrow viewport. It used to be the 6th (last) of 6 columns — i.e.
// exactly the column the overflow trims first — even though it's the column this component's
// own CSS comment calls "the single most-scanned value in this table". Moving it to 3rd (right
// after Date/Ticker) puts it inside the columns a narrow viewport renders before any scroll is
// needed. This is a DOM-order assertion rather than a real viewport/pixel measurement (no browser
// harness in this test file), but it directly encodes the root cause: column POSITION, not width
// or content, is what determines survival under horizontal overflow-clipping.
test("mobile P&L visibility: P&L is the 3rd header column, ahead of Dir/Tier/Outcome", () => {
  const html = renderTable();
  const theadMatch = html.match(/<thead>[\s\S]*?<\/thead>/);
  assert.ok(theadMatch, "thead should render");
  const thead = theadMatch![0];

  const tickerIdx = thead.indexOf(">Ticker<");
  const pnlIdx = thead.indexOf("P&amp;L");
  const dirIdx = thead.indexOf(">Dir<");
  const tierIdx = thead.indexOf(">Tier<");
  const outcomeIdx = thead.indexOf(">Outcome<");

  assert.ok(
    tickerIdx > -1 && pnlIdx > -1 && dirIdx > -1 && tierIdx > -1 && outcomeIdx > -1,
    "all six header labels should be present"
  );
  assert.ok(
    tickerIdx < pnlIdx && pnlIdx < dirIdx && dirIdx < tierIdx && tierIdx < outcomeIdx,
    `P&L header must sit right after Ticker and before Dir/Tier/Outcome (got Ticker@${tickerIdx} P&L@${pnlIdx} Dir@${dirIdx} Tier@${tierIdx} Outcome@${outcomeIdx})`
  );
});

// Regression for the live 2026-10-16 finding: the detail drawer's "Score" field rendered the
// bare `score` column (which IS `score_max` — the session-PEAK evidence score that keeps
// ratcheting up across scan ticks even AFTER a play commits; see record.ts's own doc comment
// on ZeroDteRecordPlay.score), unqualified, as though it were the score the play committed at.
// The real commit-time score lives in entry_context.score and disagreed with the peak on
// 121/215 live rows (56.3%) over a 30-day window. ZeroDteBoard.tsx (the live board) already
// renders the identical quantity correctly qualified ("peak score {row.score}"); the historical
// Track Record table did not. `commitScoreFor` is the fix: prefer the real commit-time score
// when entry_context carries one, falling back to the peak with `isPeakFallback: true` only
// when it doesn't — so the caller can label the fallback instead of presenting it as a fact.
test("commitScoreFor prefers the real commit-time score (entry_context.score) over the ratcheted peak", () => {
  const play = { score: 100, entry_context: { score: 87 } } as unknown as ZeroDteRecordPlay;
  const result = commitScoreFor(play);
  assert.equal(result.value, 87, "must report the real commit-time score, not the session-peak 100");
  assert.equal(result.isPeakFallback, false, "a real entry_context.score must not be labeled a peak fallback");
});

test("commitScoreFor falls back to the peak score, labeled, when entry_context carries no numeric score", () => {
  const noContext = { score: 61, entry_context: null } as unknown as ZeroDteRecordPlay;
  const r1 = commitScoreFor(noContext);
  assert.equal(r1.value, 61);
  assert.equal(r1.isPeakFallback, true, "a null entry_context must fall back to the peak, labeled as such");

  const garbledContext = { score: 61, entry_context: { score: "61" } } as unknown as ZeroDteRecordPlay;
  const r2 = commitScoreFor(garbledContext);
  assert.equal(r2.value, 61);
  assert.equal(r2.isPeakFallback, true, "a non-numeric entry_context.score must also fall back, labeled");
});

test("the detail drawer shows a bare 'Score' label (no qualifier) once the row is expanded and entry_context carries a real commit score", () => {
  // renderToStaticMarkup can't simulate the row's own onClick-driven expand, so this exercises
  // the exact same `commitScoreFor` the component calls per-row, over a fixture shaped like a
  // live mismatched row (TEM 2026-10-15: peak 100, committed 87) — the regression this finding
  // is actually about. The DOM-position/structure tests above already cover the collapsed-state
  // render; this covers the label/value PAIR the fix changed.
  const play = PLAYS[0];
  const withMismatch: ZeroDteRecordPlay = { ...play, score: 100, entry_context: { score: 87 } };
  const result = commitScoreFor(withMismatch);
  assert.equal(result.value, 87);
  assert.equal(result.isPeakFallback, false);

  const legacyRow: ZeroDteRecordPlay = { ...play, score: 61, entry_context: null };
  const legacy = commitScoreFor(legacyRow);
  assert.equal(legacy.value, 61);
  assert.equal(legacy.isPeakFallback, true);
});

test("mobile P&L visibility: each data row renders its P&L cell before Dir/Tier/Outcome cells", () => {
  const html = renderTable();
  const rowMatch = html.match(/<tr class="nh-history-row"[^>]*>[\s\S]*?<\/tr>/);
  assert.ok(rowMatch, "a data row should render");
  const row = rowMatch![0];

  const tickerIdx = row.indexOf("NVDA");
  const pnlIdx = row.indexOf("nh-history-pnl");
  const dirIdx = row.indexOf("nh-history-dir");

  assert.ok(tickerIdx > -1 && pnlIdx > -1 && dirIdx > -1, "ticker, P&L, and Dir cells should all render");
  assert.ok(
    tickerIdx < pnlIdx && pnlIdx < dirIdx,
    `P&L cell must render before the Dir cell (got Ticker@${tickerIdx} P&L@${pnlIdx} Dir@${dirIdx})`
  );
});
