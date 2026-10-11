import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTicker, validatePlayGeometry, MIN_RR_RATIO } from "./play-constraints";

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

// ── validatePlayGeometry: band containment (P1, 2026-08-07) ─────────────────
//
// RDDT was PUBLISHED on 2026-08-04 with a stop inside its own entry band. These pin the real
// numbers off `GET /api/market/nighthawk/edition?date=2026-08-04` rank 5.

test("REGRESSION: the real RDDT play — LONG stop INSIDE the entry band is now dropped", () => {
  const play = {
    ticker: "RDDT",
    direction: "LONG",
    entry_range: "$150.84-$158.58",
    target: "191.29",
    stop: "152.65", // inside 150.84–158.58: a fill in the bottom ~23% is stopped out on entry
  };
  const v = validatePlayGeometry(play as any);
  assert.equal(v.ok, false, "this shipped to members; it must never publish again");
  assert.ok(
    v.drops.some((d) => d.includes("inside the entry band")),
    `expected a containment drop, got ${JSON.stringify(v.drops)}`
  );
});

test("the R:R gate ALONE would have passed RDDT — which is why containment is needed", () => {
  // The perverse coupling, asserted rather than described: risk is measured from the midpoint, so
  // a stop deeper inside the band yields a HIGHER R:R. mid 154.71, risk 2.06, reward 36.58 → 17.76,
  // a ~9x outlier vs every other card that session (0.75–1.96) and far above MIN_RR_RATIO.
  const mid = (150.84 + 158.58) / 2;
  const rr = Math.abs(191.29 - mid) / Math.abs(152.65 - mid);
  assert.ok(Math.abs(rr - 17.76) < 0.01, `expected the published 17.76, got ${rr.toFixed(2)}`);
  assert.ok(rr >= MIN_RR_RATIO, "precondition: the R:R gate was satisfied — it could not catch this");
});

test("SHORT mirror: a stop inside the band is dropped", () => {
  const play = {
    ticker: "SLV",
    direction: "SHORT",
    entry_range: "$50.00-$51.23",
    target: "$45.00",
    stop: "$50.80", // inside the band
  };
  const v = validatePlayGeometry(play as any);
  assert.equal(v.ok, false);
  assert.ok(v.drops.some((d) => d.includes("inside the entry band")));
});

test("the 26 clean rows still pass — this is additive, not a tightening", () => {
  // Real published geometry that must keep publishing. SLV/LOW are the two SHORTs from the audit's
  // 27-row scan (stop above band high); MU is a LONG with the stop below band low.
  const clean = [
    { ticker: "MU", direction: "LONG", entry_range: "$903.51-$920.00", target: "$1092.12", stop: "$755.08" },
    { ticker: "SLV", direction: "SHORT", entry_range: "$49.00-$51.23", target: "$44.00", stop: "$54.72" },
    { ticker: "LOW", direction: "SHORT", entry_range: "$200.00-$209.77", target: "$180.00", stop: "$221.05" },
  ];
  for (const play of clean) {
    const v = validatePlayGeometry(play as any);
    assert.ok(
      !v.drops.some((d) => d.includes("inside the entry band")),
      `${play.ticker} must not trip containment: ${JSON.stringify(v.drops)}`
    );
  }
});

test("a stop exactly ON the band edge is rejected — the boundary fill is still stopped out", () => {
  const play = {
    ticker: "TEST", direction: "LONG",
    entry_range: "$100.00-$104.00", target: "$120.00", stop: "$100.00",
  };
  const v = validatePlayGeometry(play as any);
  assert.ok(v.drops.some((d) => d.includes("inside the entry band")), "stop == band low must drop");
});

test("containment is skipped when there is no numeric band — prose entries are unaffected", () => {
  // Conditional prose entries ("Break above X") already flag rather than drop; containment must
  // not turn that flag into a drop.
  const play = {
    ticker: "TEST", direction: "LONG",
    entry_range: "Break above 100 | reclaim", target: "$120.00", stop: "$95.00",
  };
  const v = validatePlayGeometry(play as any);
  assert.ok(!v.drops.some((d) => d.includes("inside the entry band")));
});
