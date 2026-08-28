import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";

import { NighthawkAnalyticsPanel } from "./NighthawkAnalyticsPanel";
import type { ZeroDteRecord } from "@/lib/zerodte/record";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * Member report 2026-08-28 (screenshot): on a phone-width viewport the panel's stat tiles + two
 * bar columns + P&L curve ran tall enough to push the entire play ledger (CommandDeck) below the
 * fold — "literally blocking the play panels fully". The fix collapses the panel by default to a
 * single tappable summary row; these tests pin that the FULL breakdown (tier bars, outcome bars,
 * the P&L curve section) never reaches the very first render, and that a compact summary does.
 *
 * SWRConfig's `fallback` seeds the cache synchronously so the component's first render already
 * has data — matching how the real member would eventually see it — without waiting on a network
 * fetch that node:test's renderToStaticMarkup (synchronous) has no way to await.
 */
const RECORD: ZeroDteRecord = {
  methodology: "v1",
  window: { since: "2026-07-01", through: "2026-08-28", days: 30, sessions: 20 },
  plays: [],
  total_flagged: 40,
  available: true,
  graded: 32,
  ungraded: 0,
  wins: 14,
  losses: 12,
  breakeven: 6,
  win_rate_pct: 53.8,
  avg_pnl_pct: 4.2,
  by_outcome: [],
  by_time_of_day: [],
  by_direction: [],
  by_score_band: [],
  mechanical: {
    graded: 32,
    wins: 14,
    losses: 12,
    breakeven: 6,
    win_rate_pct: 53.8,
    avg_pnl_pct: 4.2,
    by_outcome: [],
  },
} as unknown as ZeroDteRecord;

function renderPanel(): string {
  return renderToStaticMarkup(
    React.createElement(
      SWRConfig,
      { value: { fallback: { "/api/market/zerodte/record?days=30": RECORD } } },
      React.createElement(NighthawkAnalyticsPanel)
    )
  );
}

test("REGRESSION: the analytics panel is collapsed on first render, not blocking the ledger below it", () => {
  const html = renderPanel();

  assert.doesNotMatch(html, /By merit tier/, "the full tier breakdown reached the first render");
  assert.doesNotMatch(html, /By exit outcome/, "the full outcome breakdown reached the first render");
  assert.doesNotMatch(html, /session P&L · /i, "the P&L curve section reached the first render");
});

test("the collapsed row still surfaces a compact win-rate summary and an expand affordance", () => {
  const html = renderPanel();

  assert.match(html, /Session analytics/);
  assert.match(html, /53\.8%/, "win rate should be visible in the collapsed summary");
  assert.match(html, /tap to expand/i);
});

test("the collapsed toggle is a real button with aria-expanded, not a bare div", () => {
  const html = renderPanel();

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<button[^>]*aria-controls="nh-analytics-body"/);
});
