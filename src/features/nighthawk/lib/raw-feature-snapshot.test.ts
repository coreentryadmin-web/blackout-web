import test from "node:test";
import assert from "node:assert/strict";
import { buildRawFeatureSnapshot } from "./raw-feature-snapshot";
import type { TickerDossier } from "./dossier";

// Same partial-object + cast idiom deterministic-edition.test.ts's own dossier() fixture uses --
// TickerDossier has many required fields this pure module never reads, so a full literal would
// be noise; only fields this module actually consumes are set explicitly per test.
function dossier(overrides: Partial<TickerDossier> = {}): TickerDossier {
  return {
    ticker: "TEST",
    flows: [],
    flow_streak: { streak_days: 0 } as TickerDossier["flow_streak"],
    iv_rank: null,
    benzinga_price_target: null,
    tech: null,
    positioning: null,
    dark_pool: null,
    risk_reversal_skew: null,
    short_days_to_cover: null,
    oi_change: [],
    congress_trades: [],
    congress_unusual: [],
    institutional_activity: [],
    predictions_signal: null,
    fundamental_ratios: null,
    fundamental_signals: null,
    catalysts: [],
    sector: null,
    ...overrides,
  } as TickerDossier;
}

test("buildRawFeatureSnapshot: null/undefined dossier returns null, never fabricated", () => {
  assert.equal(buildRawFeatureSnapshot(null), null);
  assert.equal(buildRawFeatureSnapshot(undefined), null);
});

test("buildRawFeatureSnapshot: every field is honestly null when the underlying dossier field is absent", () => {
  const snap = buildRawFeatureSnapshot(dossier())!;
  assert.equal(snap.schema_version, 1);
  assert.equal(snap.rvol, null);
  assert.equal(snap.net_gex, null);
  assert.equal(snap.dark_pool_total_premium, null);
  assert.equal(snap.risk_reversal_skew, null);
  assert.equal(snap.iv_rank, null);
  assert.equal(snap.benzinga_price_target, null);
  assert.equal(snap.oi_change_count, 0);
  assert.equal(snap.congress_trade_count, 0);
  assert.equal(snap.predictions_signal_present, false);
  assert.equal(snap.fundamental_ratios_present, false);
  assert.deepEqual(snap.setup_tags, []);
});

test("buildRawFeatureSnapshot: technical fields read straight from dossier.tech", () => {
  const snap = buildRawFeatureSnapshot(
    dossier({
      tech: {
        ticker: "TEST",
        price: 100,
        price_session: null,
        trend: "bullish",
        setup_tags: ["breakout"],
        support_levels: [95],
        resistance_levels: [105],
        gap_zones: [],
        breakout_zones: [],
        prior_day: { high: 106, low: 94, close: 100 },
        weekly: { high: null, low: null },
        rsi14: 62,
        rel_volume: 2.4,
        atr14: 3.1,
        vwap: 99.5,
        ema20: 98,
        ema50: 95,
        ema200: 90,
        summary: "s",
      },
    })
  )!;
  assert.equal(snap.rvol, 2.4);
  assert.equal(snap.rsi14, 62);
  assert.equal(snap.atr14, 3.1);
  assert.equal(snap.vwap, 99.5);
  assert.equal(snap.trend, "bullish");
  assert.deepEqual(snap.setup_tags, ["breakout"]);
});

test("buildRawFeatureSnapshot: positioning fields read straight from dossier.positioning", () => {
  const snap = buildRawFeatureSnapshot(
    dossier({
      positioning: {
        net_gex: 1_200_000,
        gex_king_strike: 450,
        gamma_flip: 440,
        gamma_regime: "positive",
        net_vex: -50_000,
        max_pain: 445,
        negative_gamma: false,
        wall_summary: "s",
      },
    })
  )!;
  assert.equal(snap.net_gex, 1_200_000);
  assert.equal(snap.gex_king_strike, 450);
  assert.equal(snap.gamma_flip, 440);
  assert.equal(snap.gamma_regime, "positive");
  assert.equal(snap.net_vex, -50_000);
  assert.equal(snap.max_pain, 445);
  assert.equal(snap.negative_gamma, false);
});

test("buildRawFeatureSnapshot: dark pool fields read straight from dossier.dark_pool", () => {
  const snap = buildRawFeatureSnapshot(dossier({ dark_pool: { total_premium: 5_000_000, bias: "bullish" } as never }))!;
  assert.equal(snap.dark_pool_total_premium, 5_000_000);
  assert.equal(snap.dark_pool_bias, "bullish");
});

test("buildRawFeatureSnapshot: array-shaped raw feeds are captured as COUNTS, not the full payload", () => {
  const snap = buildRawFeatureSnapshot(
    dossier({
      oi_change: [{ a: 1 }, { a: 2 }] as never,
      congress_trades: [{ a: 1 }] as never,
      congress_unusual: [{ a: 1 }, { a: 2 }, { a: 3 }] as never,
      institutional_activity: [{ a: 1 }] as never,
      catalysts: [{ a: 1 }, { a: 2 }] as never,
    })
  )!;
  assert.equal(snap.oi_change_count, 2);
  assert.equal(snap.congress_trade_count, 1);
  assert.equal(snap.congress_unusual_count, 3);
  assert.equal(snap.institutional_activity_count, 1);
  assert.equal(snap.catalyst_count, 2);
});

test("buildRawFeatureSnapshot: benzinga price target is captured narrowly (price_target/firm/action), not the full object", () => {
  const snap = buildRawFeatureSnapshot(
    dossier({
      benzinga_price_target: {
        price_target: 250,
        firm: "Morgan Stanley",
        action: "raised",
        summary: "long summary text",
        published: "2026-09-01",
        url: "https://example.com",
      },
    })
  )!;
  assert.deepEqual(snap.benzinga_price_target, { price_target: 250, firm: "Morgan Stanley", action: "raised" });
});

test("buildRawFeatureSnapshot: fundamentals/predictions are presence-only booleans", () => {
  const snap = buildRawFeatureSnapshot(
    dossier({
      fundamental_ratios: {} as never,
      fundamental_signals: {} as never,
      predictions_signal: {} as never,
    })
  )!;
  assert.equal(snap.fundamental_ratios_present, true);
  assert.equal(snap.fundamental_signals_present, true);
  assert.equal(snap.predictions_signal_present, true);
});
