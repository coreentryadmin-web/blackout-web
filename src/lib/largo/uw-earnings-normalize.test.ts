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

describe("normalizeUwEarnings: units — and ONLY units", () => {
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

  test("the DOLLAR fields keep their name, their value and their provider type", () => {
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    // `expected_move` (dollars) sits right beside `expected_move_pct` (percent); confusing the
    // two is the whole hazard, so the dollar one must survive completely untouched. It stays a
    // STRING because #2419's boundary rounder preserves provider string shape on purpose.
    assert.equal(out.expected_move, "11.56");
    assert.equal(out.street_mean_est, "2.09");
    assert.equal(out.pre_earnings_close, "7.75");
    assert.equal(out.post_earnings_close, "7.2504");
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

  test("non-fraction leaves are not retyped — that is #2419's boundary, not this module's", () => {
    // Deliberate deference. core/round-for-reading.ts rounds numeric strings AS STRINGS at the
    // tool boundary, reasoning that turning "7705" into 7705 changes a shape consumers and the
    // model already read as text. Coercing here would make the earnings tools the only UW-backed
    // tools returning numbers — a second inconsistent convention in place of one.
    const out = normalizeUwEarnings(WMT_ROW) as Record<string, unknown>;
    assert.equal(typeof out.marketcap, "string");
    assert.equal(out.marketcap, "909608447417");
    assert.equal(typeof out.expected_move, "string");
  });

  test("identifiers and every other non-fraction field survive byte-identical", () => {
    const raw = {
      ticker: "0001",
      symbol: "123",
      benzinga_id: "0042",
      cusip: "912810TL2",
      some_code: "007",
      exp_form: "1e5",
      padded: " 12 ",
      note: "beat by a wide margin",
    };
    assert.deepEqual(normalizeUwEarnings(raw), raw);
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

  test("an over-precise NON-fraction field is left for #2419 to round, not silently kept", () => {
    // This module must not quietly become a second rounder. It leaves the value alone; the
    // boundary rounder that runs after every tool is what trims it. Asserting the handoff
    // explicitly, so nobody later reads the passthrough as "precision is handled here".
    const raw = { rows: [{ avg30_stock_volume: "45756696.409090909091" }] };
    assert.deepEqual(normalizeUwEarnings(raw), raw);
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
  //
  // Built with JSON.parse rather than an object literal because that is how these payloads
  // ACTUALLY arrive (`res.json()`), and because the two differ exactly where it matters: in a
  // literal, `__proto__:` is a prototype SETTER and creates no own property at all, so the
  // literal form would quietly not test the case it appears to.
  const raw = JSON.parse(
    '{"constructor":"0.5","toString":"1.25","__proto__":"9","hasOwnProperty":"3"}'
  );
  const out = normalizeUwEarnings(raw) as Record<string, unknown>;

  assert.ok(
    Object.prototype.hasOwnProperty.call(raw, "__proto__"),
    "fixture must carry a real own __proto__ key, else this asserts nothing"
  );
  assert.equal(out.constructor, "0.5", "passed through as an ordinary field, not renamed");
  assert.equal(out.toString, "1.25");
  assert.equal(out.hasOwnProperty, "3");
  assert.equal(Object.getOwnPropertyDescriptor(out, "__proto__")?.value, "9");
  assert.equal(Object.getPrototypeOf(out), Object.prototype, "prototype must not be polluted");
  for (const k of Object.keys(out)) {
    assert.equal(typeof k, "string");
    assert.ok(!k.includes("function"), `${k} looks like a stringified function`);
  }
});
