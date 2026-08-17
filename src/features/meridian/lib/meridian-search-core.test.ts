import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterMeridianTimelineItems,
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
