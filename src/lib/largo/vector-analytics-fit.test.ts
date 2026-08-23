import test from "node:test";
import assert from "node:assert/strict";

import {
  fitVectorAnalyticsForModel,
  VECTOR_ANALYTICS_MIN_REGIME_ROWS,
  VECTOR_ANALYTICS_MIN_SCREENER_ROWS,
} from "@/lib/largo/vector-analytics-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";
import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";

/**
 * A payload shaped like the real one, at the tool's OWN documented caps. `regimeDays` is the
 * caller-settable growth term (`clampDailyRegimeDays` accepts 1..30), so it is the knob these
 * tests turn.
 */
function analyticsPayload({ regimeDays = 15, screenerRows = 15 } = {}) {
  const TICKERS = ["NVDA","TSLA","AAPL","MSFT","AMZN","META","GOOGL","AMD","ASTS","PLTR","COIN","MSTR","AVGO","NFLX","SMCI"];
  const screenerRow = (i: number) => ({
    ticker: TICKERS[i % TICKERS.length],
    spot: 222.06,
    gamma_flip: 219.5,
    top_call_wall: 230,
    top_put_wall: 215,
    top_call_pct: 12.34,
    top_put_pct: 9.87,
  });
  const preset = (basis: string, filter: string) => ({
    basis,
    universe_filter: filter,
    matched_universe: 55,
    rankable_rows: 41,
    excluded_no_metric: 14,
    returned: screenerRows,
    truncated: true,
    max_rows: 15,
    rows: Array.from({ length: screenerRows }, (_, i) => screenerRow(i)),
    empty_reason: null,
  });
  return {
    available: true,
    ticker: "SPX",
    as_of: "2026-08-22T18:40:00.000Z",
    as_of_et: "2026-08-22 14:40 ET",
    session_date: "2026-08-22",
    session_ymd: "2026-08-22",
    timeframe_min: 5,
    bars_analyzed: 1170,
    aggregated_bars: 234,
    reference_price: 7737.83,
    volume_profile: {
      poc: 7730, value_area_low: 7690, value_area_high: 7770, bucket_size: 2.5,
      total_volume: 98765432,
      top_buckets: Array.from({ length: 8 }, (_, i) => ({ price: 7700 + i * 5, volume: 12345678 - i * 900000 })),
      empty_reason: null,
    },
    market_structure: {
      pivot_k: 3,
      pivots: Array.from({ length: 12 }, (_, i) => ({
        time: 1_755_800_000 + i * 300, at_et: "2026-08-22 14:00 ET", session_date: "2026-08-22",
        price: 7730 + i, kind: "high", label: "HH",
      })),
      events: Array.from({ length: 8 }, (_, i) => ({
        time: 1_755_800_000 + i * 600, at_et: "2026-08-22 14:00 ET", session_date: "2026-08-22",
        level: 7725 + i, type: "BOS", direction: "up",
      })),
      latest_event: {
        time: 1_755_806_000, at_et: "2026-08-22 14:40 ET", session_date: "2026-08-22",
        level: 7740, type: "CHOCH", direction: "down",
      },
    },
    fib_swing: {
      direction: "up", high: 7760, low: 7680, from_time: 1_755_790_000, to_time: 1_755_806_000,
      retracements: [0.382, 0.5, 0.618, 0.786].map((ratio) => ({ ratio, price: 7729.44 })),
      golden_pocket: { top: 7729.6, bottom: 7719.2, ratios: [0.618, 0.65] },
    },
    fib_swing_empty_reason: null,
    key_levels: {
      opening_range_minutes: 15,
      hod_lod: [{ key: "hod", label: "HOD", price: 7760 }, { key: "lod", label: "LOD", price: 7680 }],
      opening_range: [{ key: "orh", label: "OR-H 15m", price: 7745 }],
      session_fib: Array.from({ length: 5 }, (_, i) => ({ key: `fib${i}`, label: `Fib ${i}`, price: 7700 + i * 10 })),
      prior_day: [{ key: "pdh", label: "PDH", price: 7755 }],
      floor_pivots: Array.from({ length: 7 }, (_, i) => ({ key: `p${i}`, label: `P${i}`, price: 7700 + i * 8 })),
      prior_session_ohlc: { open: 7700, high: 7755, low: 7690, close: 7721 },
    },
    opex: { next_opex: "2026-09-18", days_until: 27, is_quarterly: true },
    daily_regime: {
      rows: Array.from({ length: regimeDays }, (_, i) => ({
        session: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`,
        gammaFlip: 7650 + i, topCallWall: 7800, topPutWall: 7600, samples: 3720,
      })),
      coverage: { sessions: regimeDays, first: "2026-08-01", last: "2026-08-22", requested_days: regimeDays },
      retention_note: "Dealer-regime history is recorded per session and retained ~15 days.",
    },
    screener: {
      universe_size: 55,
      updated_at: "2026-08-22T18:37:00.000Z",
      updated_at_et: "2026-08-22 14:37 ET",
      updated_at_session_date: "2026-08-22",
      nearest_flip: preset("smallest |gamma flip − spot| / spot first", "none — the whole universe"),
      most_pinned: preset("strongest wall on either side", "spot at or above the gamma flip"),
      most_explosive: preset("smallest |gamma flip − spot| / spot first", "spot below the gamma flip"),
    },
    ticker_comparison: {
      rows: Array.from({ length: 5 }, (_, i) => ({
        ticker: TICKERS[i], is_active: i === 0, regime: "above", flip_distance_pct: -1.23, wall_strength: 12.34,
      })),
      empty_reason: null,
    },
    coaching: null,
    unavailable_sections: [] as string[],
    coaching_scope: "spx",
  };
}

const size = (o: unknown) => JSON.stringify(o).length;

test("the premise: at its own maximum regimeDays the payload is past the safety budget", () => {
  // Non-vacuous guard. This fix is about a spent MARGIN, not a live truncation — if that stops
  // being true, the tests below could pass while testing nothing.
  const max = analyticsPayload({ regimeDays: 30 });
  assert.ok(size(max) > LARGO_RESULT_CHAR_BUDGET, "regimeDays=30 should exceed the 14,000 budget");
  // And the honest other half: it was never over the transport cap. An earlier estimate said it
  // was; that estimate modelled ticker_comparison at 15 rows instead of DEFAULT_MAX_COMPARISONS+1.
  assert.ok(size(max) < MAX_TOOL_RESULT_CHARS, "regimeDays=30 should still be under the 16,000 cap");
});

test("fits the budget at every regimeDays the clamp accepts", () => {
  for (const regimeDays of [1, 5, 15, 22, 25, 30]) {
    const fitted = fitVectorAnalyticsForModel(analyticsPayload({ regimeDays }));
    assert.ok(
      size(fitted) <= LARGO_RESULT_CHAR_BUDGET,
      `regimeDays=${regimeDays} produced ${size(fitted)} chars, over the ${LARGO_RESULT_CHAR_BUDGET} budget`
    );
  }
});

test("leaves a payload that already fits completely untouched", () => {
  const small = analyticsPayload({ regimeDays: 1 });
  const fitted = fitVectorAnalyticsForModel(small) as Record<string, unknown>;
  assert.deepEqual(
    (fitted.daily_regime as { rows: unknown[] }).rows,
    small.daily_regime.rows,
    "no trimming should occur when the payload is already inside the budget"
  );
  const fit = fitted.fit as Record<string, { truncated: boolean; note: string }>;
  assert.equal(fit.daily_regime_rows.truncated, false);
  assert.equal(fit.screener_rows.truncated, false);
  assert.match(fit.screener_rows.note, /All 45 screener rows/);
});

test("trims daily_regime before the screener — history yields before the ranking", () => {
  const fitted = fitVectorAnalyticsForModel(analyticsPayload({ regimeDays: 30 })) as Record<string, unknown>;
  const fit = fitted.fit as Record<string, { returned: number; total: number; truncated: boolean }>;
  assert.equal(fit.daily_regime_rows.total, 30);
  assert.ok(fit.daily_regime_rows.truncated, "daily_regime should be the section that gives way first");
  assert.equal(fit.screener_rows.returned, 45, "the screener should still be whole at this size");
  assert.equal(fit.screener_rows.truncated, false);
});

test("keeps the MOST RECENT regime sessions, not the oldest", () => {
  const payload = analyticsPayload({ regimeDays: 30 });
  const fitted = fitVectorAnalyticsForModel(payload) as Record<string, unknown>;
  const kept = (fitted.daily_regime as { rows: Array<{ gammaFlip: number }> }).rows;
  const originals = payload.daily_regime.rows;
  assert.ok(kept.length > 0 && kept.length < originals.length);
  assert.equal(
    kept[kept.length - 1]!.gammaFlip,
    originals[originals.length - 1]!.gammaFlip,
    "the newest recorded session must survive"
  );
});

test("states the REAL totals, so a sample is never counted as the universe", () => {
  const fitted = fitVectorAnalyticsForModel(analyticsPayload({ regimeDays: 30 })) as Record<string, unknown>;
  const fit = fitted.fit as Record<string, { total: number; note: string }>;
  assert.equal(fit.daily_regime_rows.total, 30);
  assert.equal(fit.screener_rows.total, 45);
  assert.equal(fit.market_structure_pivots.total, 12);
  assert.match(fit.daily_regime_rows.note, /`daily_regime\.coverage` states the real window/);
});

test("a preset's own counters stay honest after a trim", () => {
  // Force deep trimming with an oversized screener so the screener rung is actually reached.
  const payload = analyticsPayload({ regimeDays: 30, screenerRows: 15 });
  const bloated = {
    ...payload,
    // A fat extra block that forces the ladder past the daily_regime rungs.
    key_levels: { ...payload.key_levels, filler: "x".repeat(4000) },
  };
  const fitted = fitVectorAnalyticsForModel(bloated) as Record<string, unknown>;
  const screener = fitted.screener as Record<string, { rows: unknown[]; returned: number; truncated: boolean; matched_universe: number; rankable_rows: number }>;
  for (const key of ["nearest_flip", "most_pinned", "most_explosive"]) {
    const preset = screener[key]!;
    assert.equal(preset.returned, preset.rows.length, `${key}.returned must equal the rows actually present`);
    assert.equal(preset.truncated, preset.rows.length < preset.rankable_rows);
    // Facts about the SCREEN, not the sample — these must survive untouched.
    assert.equal(preset.matched_universe, 55);
    assert.equal(preset.rankable_rows, 41);
  }
});

test("never trims below the stated floors", () => {
  const payload = analyticsPayload({ regimeDays: 30 });
  const pathological = { ...payload, key_levels: { filler: "x".repeat(50_000) } };
  const fitted = fitVectorAnalyticsForModel(pathological) as Record<string, unknown>;
  const regimeRows = (fitted.daily_regime as { rows: unknown[] }).rows;
  const screener = fitted.screener as Record<string, { rows: unknown[] }>;
  assert.equal(regimeRows.length, VECTOR_ANALYTICS_MIN_REGIME_ROWS);
  assert.equal(screener.nearest_flip!.rows.length, VECTOR_ANALYTICS_MIN_SCREENER_ROWS);
  // Over budget is still possible with a pathological base — the contract is that we trim to the
  // floor and DISCLOSE it, never that we mutilate the payload chasing an impossible target.
  const fit = fitted.fit as Record<string, { truncated: boolean }>;
  assert.equal(fit.daily_regime_rows.truncated, true);
  assert.equal(fit.screener_rows.truncated, true);
});

test("market_structure events and latest_event are never sampled", () => {
  const payload = analyticsPayload({ regimeDays: 30 });
  const pathological = { ...payload, key_levels: { filler: "x".repeat(50_000) } };
  const fitted = fitVectorAnalyticsForModel(pathological) as Record<string, unknown>;
  const ms = fitted.market_structure as { events: unknown[]; latest_event: unknown };
  assert.equal(ms.events.length, 8, "the BOS/CHoCH sequence is the actionable read and stays whole");
  assert.deepEqual(ms.latest_event, payload.market_structure.latest_event);
});

test("the fit block sits early in key order, not last", () => {
  const fitted = fitVectorAnalyticsForModel(analyticsPayload()) as Record<string, unknown>;
  const keys = Object.keys(fitted);
  const fitIdx = keys.indexOf("fit");
  assert.ok(fitIdx > -1);
  // #2649's lesson: the transport's cut is a HEAD slice, so anything last is what goes first.
  assert.ok(fitIdx < keys.indexOf("screener"), "fit must precede the big sections");
  assert.ok(fitIdx < keys.indexOf("unavailable_sections"));
  assert.equal(keys[fitIdx - 1], "session_ymd", "inserted after the time anchors");
});

test("an unavailable envelope passes through untouched", () => {
  const err = { available: false, ticker: "ZZZZ", error: "vector_analytics_failed" };
  assert.deepEqual(fitVectorAnalyticsForModel(err), err);
});

test("absent sections do not fabricate rows or throw", () => {
  const bare = { available: true, ticker: "ZZZZ", session_ymd: "2026-08-22", screener: null, daily_regime: null };
  const fitted = fitVectorAnalyticsForModel(bare) as Record<string, unknown>;
  const fit = fitted.fit as Record<string, { returned: number; total: number; note: string }>;
  assert.equal(fit.daily_regime_rows.total, 0);
  assert.equal(fit.screener_rows.total, 0);
  assert.match(fit.daily_regime_rows.note, /No recorded sessions on this read/);
  assert.equal(fitted.screener, null, "a null section stays null rather than becoming an empty object");
});
