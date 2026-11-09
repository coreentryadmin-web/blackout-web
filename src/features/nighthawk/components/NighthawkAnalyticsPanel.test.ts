import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";

import { NighthawkAnalyticsPanel, humanizeOutcomeLabel } from "./NighthawkAnalyticsPanel";
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
  assert.match(html, /tap for history/i);
});

test("REGRESSION 2026-08-29: the collapsed row hints that History (with its date-range picker) is nested inside — otherwise it has zero visible affordance until expanded", () => {
  const html = renderPanel();

  assert.match(html, /nh-analytics-panel-history-hint/, "the history hint icon should render while collapsed");
});

test("the collapsed toggle is a real button with aria-expanded, not a bare div", () => {
  const html = renderPanel();

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<button[^>]*aria-controls="nh-analytics-body"/);
});

// REGRESSION (live P3, 2026-11-09): record.ts's managedOutcomeLabel() stamps the bare coarse code
// "flat_scratch" for every "flat" by_outcome bucket (no `flat_theta_bleed` prefix, and unlike
// `thesis_break` it never carries a variable suffix either), but OUTCOME_BUCKET_LABEL had no entry
// and no fallback for the exact string "flat_scratch" — so it fell through to `return raw` and
// rendered the literal snake_case string instead of "flat scratch" wherever a `by_outcome` bucket
// label is humanized (BucketRows, in the expanded view). Confirmed live:
// GET /api/market/zerodte/record?days=14 returned `by_outcome: [...,{"label":"flat_scratch",...}]`.
// RED (pre-fix): humanizeOutcomeLabel("flat_scratch") === "flat_scratch".
// GREEN (post-fix): "flat scratch".
test("REGRESSION: humanizeOutcomeLabel renders the bare 'flat_scratch' bucket humanized, not raw snake_case", () => {
  assert.equal(humanizeOutcomeLabel("flat_scratch"), "flat scratch");
  assert.notEqual(humanizeOutcomeLabel("flat_scratch"), "flat_scratch");
});

// The bare code "ratchet" (no ratchet_*_floor suffix) is also stamped directly by
// managedOutcomeLabel() for a defensive-floor exit. It already reads as a plain English word via
// the `return raw` fallthrough, so this was not a visible bug the way "flat_scratch" was — but it
// is now an explicit, documented identity entry (matching the doubled/stopped pattern already in
// this map) instead of an accidental fallthrough, so it can't silently regress if the raw code
// ever grows a suffix of its own.
test("humanizeOutcomeLabel renders the bare 'ratchet' bucket correctly (already-legible fallthrough, now explicit)", () => {
  assert.equal(humanizeOutcomeLabel("ratchet"), "ratchet");
});

// thesis_break keeps its startsWith() fallback for the variable ":<source>" suffix it always
// carries — pinning this alongside the two regressions above so the three bare/near-bare codes
// record.ts's collapsed outcome vocabulary can stamp (ratchet, thesis_break, flat_scratch) are
// all covered by one test file rather than only the two that were ever actually broken.
test("humanizeOutcomeLabel still strips the thesis_break:<source> suffix", () => {
  assert.equal(humanizeOutcomeLabel("thesis_break:gex-walls"), "thesis break");
  assert.equal(humanizeOutcomeLabel("thesis_break"), "thesis break");
});
