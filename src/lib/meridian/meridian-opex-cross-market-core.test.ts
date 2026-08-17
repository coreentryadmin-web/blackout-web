import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMeridianOpexCrossMarket,
  buildMeridianOpexReport,
  rankOpexSessionMovers,
  summarizeMag7Sessions,
} from "./meridian-opex-cross-market-core";
import type { SessionReaction } from "./meridian-reaction-core";

function rx(session: number | null, next: number | null = null): SessionReaction {
  return { session_change_pct: session, next_day_change_pct: next };
}

function mapOf(entries: Record<string, SessionReaction>): Map<string, SessionReaction> {
  return new Map(Object.entries(entries));
}

test("rankOpexSessionMovers: filters illiquid and picks extremes", () => {
  const { top_gainer, top_loser } = rankOpexSessionMovers([
    { T: "AAA", o: 10, c: 12, v: 2_000_000, h: 12, l: 10, vw: 11 },
    { T: "BBB", o: 50, c: 47.5, v: 3_000_000, h: 50, l: 47, vw: 49 },
    { T: "PENNY", o: 1, c: 2, v: 5_000_000, h: 2, l: 1, vw: 1.5 },
    { T: "TOOLONG", o: 20, c: 30, v: 2_000_000, h: 30, l: 20, vw: 25 },
  ] as never);
  assert.equal(top_gainer?.ticker, "AAA");
  assert.equal(top_gainer?.session_pct, 20);
  assert.equal(top_loser?.ticker, "BBB");
  assert.equal(top_loser?.session_pct, -5);
});

test("summarizeMag7Sessions: avg best worst", () => {
  const summary = summarizeMag7Sessions([
    { ticker: "NVDA", session_pct: 2 },
    { ticker: "AAPL", session_pct: -1 },
    { ticker: "MSFT", session_pct: 0.5 },
  ]);
  assert.equal(summary.avg_session_pct, 0.5);
  assert.equal(summary.best?.ticker, "NVDA");
  assert.equal(summary.worst?.ticker, "AAPL");
});

test("buildMeridianOpexCrossMarket: aggregates and headline", () => {
  const dates = ["2026-06-20", "2026-05-16"];
  const cm = buildMeridianOpexCrossMarket({
    dates,
    spx: mapOf({ "2026-06-20": rx(0.4), "2026-05-16": rx(-0.2) }),
    spy: mapOf({ "2026-06-20": rx(0.3), "2026-05-16": rx(-0.1) }),
    qqq: mapOf({ "2026-06-20": rx(0.6), "2026-05-16": rx(-0.3) }),
    iwm: mapOf({ "2026-06-20": rx(0.1), "2026-05-16": rx(0) }),
    mag7ByTicker: new Map([
      ["NVDA", mapOf({ "2026-06-20": rx(1.2), "2026-05-16": rx(-0.5) })],
      ["AAPL", mapOf({ "2026-06-20": rx(0.8), "2026-05-16": rx(-0.2) })],
      ["MSFT", mapOf({ "2026-06-20": rx(0.4), "2026-05-16": rx(0.1) })],
      ["GOOG", mapOf({ "2026-06-20": rx(0.2), "2026-05-16": rx(-0.1) })],
      ["AMZN", mapOf({ "2026-06-20": rx(0.3), "2026-05-16": rx(-0.2) })],
      ["META", mapOf({ "2026-06-20": rx(0.5), "2026-05-16": rx(-0.3) })],
      ["TSLA", mapOf({ "2026-06-20": rx(0.9), "2026-05-16": rx(-0.4) })],
    ]),
    moversByDate: new Map([
      ["2026-06-20", { top_gainer: { ticker: "RUN", session_pct: 12, close: 20, volume: 2e6 }, top_loser: { ticker: "XYZ", session_pct: -8, close: 30, volume: 2e6 } }],
      ["2026-05-16", { top_gainer: { ticker: "ABC", session_pct: 9, close: 15, volume: 2e6 }, top_loser: { ticker: "DEF", session_pct: -6, close: 40, volume: 2e6 } }],
    ]),
  });
  assert.equal(cm.available, true);
  assert.equal(cm.sample_size, 2);
  assert.equal(cm.aggregates.avg_spx_session_pct, 0.1);
  assert.ok(cm.headline?.includes("SPX"));
  assert.equal(cm.rows[0]?.top_gainer?.ticker, "RUN");
});

test("buildMeridianOpexReport: risk-on when avg SPX positive", () => {
  const cross_market = buildMeridianOpexCrossMarket({
    dates: ["2026-06-20"],
    spx: mapOf({ "2026-06-20": rx(0.8) }),
    spy: mapOf({ "2026-06-20": rx(0.5) }),
    qqq: mapOf({ "2026-06-20": rx(1.0) }),
    iwm: mapOf({ "2026-06-20": rx(0.2) }),
    mag7ByTicker: new Map([
      ["NVDA", mapOf({ "2026-06-20": rx(1.5) })],
      ["AAPL", mapOf({ "2026-06-20": rx(0.4) })],
      ["MSFT", mapOf({ "2026-06-20": rx(0.3) })],
      ["GOOG", mapOf({ "2026-06-20": rx(0.2) })],
      ["AMZN", mapOf({ "2026-06-20": rx(0.1) })],
      ["META", mapOf({ "2026-06-20": rx(0.6) })],
      ["TSLA", mapOf({ "2026-06-20": rx(0.9) })],
    ]),
    moversByDate: new Map([
      ["2026-06-20", { top_gainer: { ticker: "RUN", session_pct: 10, close: 20, volume: 2e6 }, top_loser: null }],
    ]),
  });
  const report = buildMeridianOpexReport({
    cross_market,
    pin_accuracy: { graded: 2, held: 1, accuracy_pct: 50, tolerance_pct: 0.35, headline: "Max pain held 1/2" },
    spx_positioning: { available: true, spot: 5500, flip: null, flip_distance_pts: null, call_wall: null, put_wall: null, net_gex_label: null, gamma_regime: "positive gamma" },
  });
  assert.equal(report.available, true);
  assert.equal(report.outlook.lean, "risk_on");
  assert.ok(report.watch_list.some((w) => w.includes("NVDA")));
});
