import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { normalizeUwEarnings, UW_FRACTION_FIELDS } from "./uw-earnings-normalize";

/** A real `/api/earnings/premarket` row, verbatim from live UW (2026-08-20 session). */
const WMT_ROW = {
  symbol: "WMT",
  source: "company",
  full_name: "WALMART",
  sector: "Consumer Defensive",
  is_s_p_500: true,
  reaction: "-0.0915",
  has_options: true,
  marketcap: "909608447417",
  report_date: "2026-08-20",
  report_time: "premarket",
  expected_move_perc: "0.042278",
  expected_move: "11.56",
  street_mean_est: "2.09",
  ending_fiscal_quarter: "2026-06-30",
  actual_eps: null,
  pre_earnings_close: "7.75",
  post_earnings_close: "7.2504",
};

describe("normalizeUwEarnings: units, types and precision", () => {
  test("a fraction becomes a percent under a _pct name — the 100x misread this prevents", () => {
    // WMT fell 9.15% on its print. Served raw as `reaction: "-0.0915"`, a model reading it as
    // a percent reports a 0.09% slip — a confident answer that is wrong by two orders of
    // magnitude on the number members ask for most.
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;

    assert.equal(out.reaction_pct, -9.15);
    assert.equal("reaction" in out, false, "the raw fraction must not also survive");
  });

  test("expected_move_perc agrees with the 0DTE surface's x100 convention", () => {
    // src/lib/zerodte/earnings.ts has always done `Number(emRaw) * 100`. These tools used to
    // contradict it; now they agree.
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    assert.equal(out.expected_move_pct, 4.23);
    assert.equal("expected_move_perc" in out, false);
  });

  test("the DOLLAR fields keep their name and are not rescaled", () => {
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    // `expected_move` (dollars) sits right beside `expected_move_pct` (percent); confusing the
    // two is the whole hazard, so the dollar one must survive untouched and unrenamed.
    assert.equal(out.expected_move, 11.56);
    assert.equal(out.street_mean_est, 2.09);
    assert.equal(out.pre_earnings_close, 7.75);
    assert.equal(out.post_earnings_close, 7.2504, "4dp is real price precision, not noise");
  });

  test("24 decimals of false precision are cut to 2 on a percent", () => {
    const out = normalizeUwEarnings({
      expected_move_perc: "0.05330873875951118285",
      post_earnings_move_1w: "-0.04864187586700675706",
      pre_earnings_move_2w: "0.07525381321272193620",
      short_straddle_1d: "0.59846743295019157088",
      long_straddle_1d: "-0.62030075187969924812",
    }) as Record<string, number>;

    assert.equal(out.expected_move_pct, 5.33);
    assert.equal(out.post_earnings_move_1w_pct, -4.86);
    assert.equal(out.pre_earnings_move_2w_pct, 7.53);
    // Straddle fields are returns — verified live as near-mirror pairs across every NVDA print.
    assert.equal(out.short_straddle_1d_pct, 59.85);
    assert.equal(out.long_straddle_1d_pct, -62.03);
  });

  test("every declared fraction field is actually rewritten", () => {
    const raw = Object.fromEntries(UW_FRACTION_FIELDS.map((f) => [f, "0.1"]));
    const out = normalizeUwEarnings(raw) as Record<string, number>;

    for (const f of UW_FRACTION_FIELDS) {
      assert.equal(f in out, false, `${f} should have been renamed away`);
    }
    assert.equal(Object.keys(out).length, UW_FRACTION_FIELDS.length);
    for (const v of Object.values(out)) assert.equal(v, 10);
  });

  test("a null fraction stays null under the NEW name, never disappears", () => {
    // "UW has no reading for this print" and "this field does not exist" are different facts.
    const out = normalizeUwEarnings({
      expected_move_perc: null,
      reaction: null,
    }) as Record<string, unknown>;

    assert.equal(out.expected_move_pct, null);
    assert.equal(out.reaction_pct, null);
    assert.equal("expected_move_perc" in out, false);
  });

  test("dates, sectors and report_time are left completely alone", () => {
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    assert.equal(out.report_date, "2026-08-20");
    assert.equal(out.ending_fiscal_quarter, "2026-06-30");
    assert.equal(out.report_time, "premarket");
    assert.equal(out.sector, "Consumer Defensive");
    assert.equal(out.full_name, "WALMART");
    assert.equal(out.source, "company");
    assert.equal(out.is_s_p_500, true);
    assert.equal(out.has_options, true);
    assert.equal(out.actual_eps, null);
  });

  test("a numeric string becomes a number so arithmetic and comparison work", () => {
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    assert.equal(typeof out.marketcap, "number");
    assert.equal(out.marketcap, 909_608_447_417);
    assert.equal(typeof out.expected_move, "number");
  });

  test("identifier-ish strings are never coerced into numbers", () => {
    const out = normalizeUwEarnings({
      ticker: "0001",
      symbol: "123",
      benzinga_id: "0042",
      cusip: "912810TL2",
      // Leading zeros are not canonical JSON numbers, so this survives as a string even under
      // a key that is not on the never-numeric list.
      some_code: "007",
      // Scientific notation is left alone.
      exp_form: "1e5",
      // Whitespace padding IS tolerated — it is an upstream formatting artifact, not meaning.
      padded: " 12 ",
      // ...but trimming does not rescue a leading zero.
      padded_id: " 007 ",
    }) as Record<string, unknown>;

    assert.equal(out.ticker, "0001");
    assert.equal(out.symbol, "123");
    assert.equal(out.benzinga_id, "0042");
    assert.equal(out.cusip, "912810TL2");
    assert.equal(out.some_code, "007");
    assert.equal(out.exp_form, "1e5");
    assert.equal(out.padded, 12);
    assert.equal(out.padded_id, " 007 ");
  });

  test("nested and array shapes normalize — estimates arrive wrapped, rows arrive flat", () => {
    // /api/earnings/{ticker} is a flat row array; /api/companies/{t}/earnings-estimates is
    // { ticker, estimates: [...] }. Both reach these tools, so the walk must handle either.
    const out = normalizeUwEarnings({
      ticker: "NVDA",
      earnings: [{ reaction: "-0.0915" }, { reaction: "0.0126" }],
      estimates: { ticker: "NVDA", rows: [{ eps_estimate_average: 12.7984 }] },
    }) as {
      earnings: Array<Record<string, unknown>>;
      estimates: { rows: Array<Record<string, unknown>> };
      ticker: string;
    };

    assert.equal(out.earnings[0].reaction_pct, -9.15);
    assert.equal(out.earnings[1].reaction_pct, 1.26);
    assert.equal(out.estimates.rows[0].eps_estimate_average, 12.7984);
    assert.equal(out.ticker, "NVDA", "a ticker that looks like a word is untouched");
  });

  test("already-numeric estimate values survive with their real precision", () => {
    // The estimates endpoint serves genuine JSON numbers, not strings. Normalizing must not
    // quantize a legitimate 4dp estimate or mangle a large integer revenue figure.
    const out = normalizeUwEarnings({
      eps_estimate_high: 16.1952,
      eps_estimate_average: 12.7984,
      revenue_estimate_average: 562431809650,
      eps_estimate_analyst_count: 48,
    }) as Record<string, number>;

    assert.equal(out.eps_estimate_high, 16.1952);
    assert.equal(out.eps_estimate_average, 12.7984);
    assert.equal(out.revenue_estimate_average, 562431809650);
    assert.equal(out.eps_estimate_analyst_count, 48);
  });

  test("no leaf survives with more than four decimal places", () => {
    // The systemic guard: false precision must not come back through some field nobody listed.
    const out = normalizeUwEarnings({
      rows: [{ a: "1.23456789012345678", b: 9.87654321098, c: "0.0533087387595111828" }],
    });

    const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;
    for (const v of Object.values((out as { rows: Record<string, number>[] }).rows[0])) {
      assert.ok(decimals(v) <= 4, `${v} kept ${decimals(v)} decimals`);
    }
  });

  test("normalizing twice changes nothing — the rename is not applied to its own output", () => {
    const once = normalizeUwEarnings(WMT_ROW);
    const twice = normalizeUwEarnings(once);
    assert.deepEqual(twice, once);
  });
});

test("a payload key colliding with Object.prototype is not treated as a fraction field", () => {
  // The rename table is consulted with arbitrary keys off UW's wire. A bare object lookup
  // would resolve `constructor` to a truthy FUNCTION and use it as the output key name.
  const out = normalizeUwEarnings({
    constructor: "0.5",
    toString: "1.25",
    __proto__: "9",
    hasOwnProperty: "3",
  }) as Record<string, unknown>;

  assert.equal(out.constructor, 0.5, "coerced as an ordinary numeric field, not renamed");
  assert.equal(out.toString, 1.25);
  assert.equal(out.hasOwnProperty, 3);
  for (const k of Object.keys(out)) {
    assert.equal(typeof k, "string");
    assert.ok(!k.includes("function"), `${k} looks like a stringified function`);
  }
});
