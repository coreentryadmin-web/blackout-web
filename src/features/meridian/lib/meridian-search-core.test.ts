import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterMeridianTimelineItems,
  findEarningsTimelineItemId,
  isTickerLikeQuery,
  normalizeMeridianSearchQuery,
} from "./meridian-search-core";
import type { MeridianTimelineItem } from "./meridian-types";

const sample: MeridianTimelineItem[] = [
  {
    id: "earnings:NVDA:2026-08-20",
    kind: "earnings",
    title: "NVDA earnings",
    subtitle: "NVIDIA Corp",
    date: "2026-08-20",
    time: "16:20",
    impact: "high",
    days_until: 3,
    ticker: "NVDA",
  },
  {
    id: "macro:2026-08-15:CPI",
    kind: "macro",
    title: "CPI",
    subtitle: "US macro",
    date: "2026-08-15",
    time: "08:30",
    impact: "high",
    days_until: 0,
    ticker: null,
  },
];

test("normalizeMeridianSearchQuery uppercases and trims", () => {
  assert.equal(normalizeMeridianSearchQuery("  nvda "), "NVDA");
});

test("isTickerLikeQuery accepts tickers only", () => {
  assert.equal(isTickerLikeQuery("NVDA"), true);
  assert.equal(isTickerLikeQuery("inflation"), false);
  assert.equal(isTickerLikeQuery("123"), false);
});

test("filterMeridianTimelineItems matches ticker and title", () => {
  assert.equal(filterMeridianTimelineItems(sample, "nvda").length, 1);
  assert.equal(filterMeridianTimelineItems(sample, "cpi").length, 1);
  assert.equal(filterMeridianTimelineItems(sample, "").length, 2);
  assert.equal(filterMeridianTimelineItems(sample, "xyz").length, 0);
});

test("findEarningsTimelineItemId: resolves the real row id, case-insensitively", () => {
  assert.equal(findEarningsTimelineItemId(sample, "nvda"), "earnings:NVDA:2026-08-20");
  assert.equal(findEarningsTimelineItemId(sample, "NVDA"), "earnings:NVDA:2026-08-20");
});

test("findEarningsTimelineItemId: null when the ticker has no timeline row", () => {
  // The exact bug this guards against: `earnings_week` / `estimate_revision_timeline` /
  // `recent_earnings_revisions` are built from the RAW Benzinga window (no options-chain
  // filter), while the timeline rows this id must resolve against are optionable-filtered — so
  // a ticker named by one of those panels can legally be absent from `allItems`. Hand-building
  // `earnings:${ticker}:${date}` and navigating to it unconditionally used to select an id with
  // no matching row, leaving the detail pane stuck on "Select a catalyst" — a dead click that
  // reads as a broken button. The lookup must return null so the caller can no-op instead.
  assert.equal(findEarningsTimelineItemId(sample, "ZZZZ"), null);
});

test("findEarningsTimelineItemId: never matches a non-earnings row by ticker", () => {
  const items: MeridianTimelineItem[] = [
    {
      id: "fda:NVDA:2026-08-14",
      kind: "fda",
      title: "FDA decision",
      subtitle: null,
      date: "2026-08-14",
      time: null,
      impact: "high",
      days_until: 1,
      ticker: "NVDA",
    },
  ];
  assert.equal(findEarningsTimelineItemId(items, "NVDA"), null);
});

test("findEarningsTimelineItemId: blank/whitespace ticker never matches", () => {
  assert.equal(findEarningsTimelineItemId(sample, ""), null);
  assert.equal(findEarningsTimelineItemId(sample, "   "), null);
});
