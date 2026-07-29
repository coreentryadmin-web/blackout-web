import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTicker, deduplicateTickerFamilies, validatePlayGeometry, MIN_RR_RATIO } from "./play-constraints";

// ── canonicalTicker ─────────────────────────────────────────────────────────

test("canonicalTicker: GOOG maps to GOOGL", () => {
  assert.equal(canonicalTicker("GOOG"), "GOOGL");
  assert.equal(canonicalTicker("goog"), "GOOGL");
});

test("canonicalTicker: GOOGL stays GOOGL", () => {
  assert.equal(canonicalTicker("GOOGL"), "GOOGL");
});

test("canonicalTicker: BRK variants map to BRK.A", () => {
  assert.equal(canonicalTicker("BRK.B"), "BRK.A");
  assert.equal(canonicalTicker("BRK/B"), "BRK.A");
  assert.equal(canonicalTicker("BRKB"), "BRK.A");
});

test("canonicalTicker: unknown ticker passes through", () => {
  assert.equal(canonicalTicker("AAPL"), "AAPL");
  assert.equal(canonicalTicker("NVDA"), "NVDA");
});

// ── deduplicateTickerFamilies ───────────────────────────────────────────────

test("deduplicateTickerFamilies: GOOGL + GOOG keeps only the first", () => {
  const items = [
    { ticker: "GOOGL", score: 67 },
    { ticker: "GOOG", score: 63 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "GOOGL");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]!.item.ticker, "GOOG");
  assert.equal(dropped[0]!.canonical, "GOOGL");
  assert.equal(dropped[0]!.kept_ticker, "GOOGL");
});

test("deduplicateTickerFamilies: unrelated tickers all pass through", () => {
  const items = [
    { ticker: "FHN", score: 77 },
    { ticker: "COF", score: 72 },
    { ticker: "ZETA", score: 63 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 0);
});

test("deduplicateTickerFamilies: BRK.A + BRK.B keeps only the first", () => {
  const items = [
    { ticker: "BRK.A", score: 80 },
    { ticker: "BRK.B", score: 75 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "BRK.A");
  assert.equal(dropped.length, 1);
});

test("deduplicateTickerFamilies: order matters — higher-ranked (first) member wins", () => {
  const items = [
    { ticker: "GOOG", score: 80 },
    { ticker: "GOOGL", score: 67 },
  ];
  const { kept, dropped } = deduplicateTickerFamilies(items);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.ticker, "GOOG");
  assert.equal(dropped[0]!.item.ticker, "GOOGL");
});

// ── validatePlayGeometry: R:R minimum ──────────────────────────────────────

test("validatePlayGeometry: rejects a LONG play with R:R below minimum", () => {
  const play = {
    ticker: "AAPL",
    direction: "LONG",
    entry_range: "$150.00–$152.00",
    target: "$152.50",
    stop: "$145.00",
  };
  const v = validatePlayGeometry(play as any);
  assert.equal(v.ok, false);
  assert.ok(v.drops.some(d => d.includes("R:R")));
});

test("validatePlayGeometry: accepts a LONG play with R:R above minimum", () => {
  const play = {
    ticker: "AAPL",
    direction: "LONG",
    entry_range: "$150.00–$152.00",
    target: "$160.00",
    stop: "$148.00",
  };
  const v = validatePlayGeometry(play as any);
  assert.equal(v.ok, true);
});

test("validatePlayGeometry: rejects a SHORT play with terrible R:R", () => {
  const play = {
    ticker: "TSLA",
    direction: "SHORT",
    entry_range: "$250.00–$252.00",
    target: "$250.50",
    stop: "$260.00",
  };
  const v = validatePlayGeometry(play as any);
  assert.equal(v.ok, false);
  assert.ok(v.drops.some(d => d.includes("R:R")));
});

test("MIN_RR_RATIO is 0.75 (aligned with play-levels builder)", () => {
  assert.equal(MIN_RR_RATIO, 0.75);
});
