import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_STAMPED_BARS,
  aggTimespanFromPath,
  etSessionDate,
  etStamp,
  stampBars,
  stampPolygonAggregatePayload,
} from "./bar-session-date";

// The exact bar that produced the defect: Largo read t=1787202000000 as "the close of the prior
// session" and answered 7,641.16 for 2026-08-19. It is 2026-08-20's own bar. Live I:SPX daily
// closes, captured 2026-08-20: 08-19 -> 7707.98, 08-20 -> 7641.16.
const SPX_AUG_19 = { t: 1787115600000, c: 7707.98 };
const SPX_AUG_20 = { t: 1787202000000, c: 7641.16 };

test("a daily bar's session date is the ET calendar date of its timestamp", () => {
  assert.equal(etSessionDate(SPX_AUG_20.t), "2026-08-20");
  assert.equal(etSessionDate(SPX_AUG_19.t), "2026-08-19");
});

test("daily bars land at 01:00 ET, not midnight — the detail that made the guess go wrong", () => {
  assert.equal(etStamp(SPX_AUG_20.t), "2026-08-20 01:00 ET");
});

test("a non-timestamp yields null rather than a plausible wrong date", () => {
  for (const bad of [undefined, null, "", "not-a-number", NaN, {}]) {
    assert.equal(etSessionDate(bad), null);
    assert.equal(etStamp(bad), null);
  }
});

test("stamped daily bars answer the question that was answered wrong", () => {
  const stamped = stampBars([SPX_AUG_19, SPX_AUG_20], "day");
  const aug19 = stamped.find((b) => b.session_date === "2026-08-19");
  assert.equal(aug19?.c, 7707.98, "2026-08-19 must resolve to its own close, not the next bar's");
  assert.equal(stamped.find((b) => b.session_date === "2026-08-20")?.c, 7641.16);
});

test("intraday bars get a full ET timestamp and no session_date claim", () => {
  // 2026-08-20 14:30Z = 10:30 ET.
  const [bar] = stampBars([{ t: Date.UTC(2026, 7, 20, 14, 30), c: 7650 }], "minute");
  assert.equal(bar.et, "2026-08-20 10:30 ET");
  assert.equal(bar.session_date, undefined);
});

test("a bar with no usable t passes through unstamped", () => {
  const [bar] = stampBars([{ c: 1 } as Record<string, unknown>], "day");
  assert.equal(bar.session_date, undefined);
  assert.equal(bar.c, 1);
});

test("timespan is read off the aggregates path, and only off an aggregates path", () => {
  assert.equal(
    aggTimespanFromPath("/v2/aggs/ticker/I:SPX/range/1/day/2026-08-13/2026-08-20"),
    "day"
  );
  assert.equal(aggTimespanFromPath("/v2/aggs/ticker/AAPL/range/15/minute/2026-08-19/2026-08-20"), "minute");
  assert.equal(aggTimespanFromPath("/v2/aggs/ticker/AAPL/prev"), null);
  assert.equal(aggTimespanFromPath("/v3/reference/tickers"), null);
  assert.equal(aggTimespanFromPath(undefined), null);
});

test("the passthrough stamps an aggregates payload and leaves everything else byte-identical", () => {
  const aggs = { status: "OK", results: [SPX_AUG_19, SPX_AUG_20] };
  const out = stampPolygonAggregatePayload(
    "/v2/aggs/ticker/I:SPX/range/1/day/2026-08-13/2026-08-20",
    aggs
  ) as { status: string; results: Array<{ session_date?: string; c: number }> };
  assert.equal(out.status, "OK");
  assert.equal(out.results[1].session_date, "2026-08-20");

  // A non-aggregates endpoint, an empty result set, and a non-object payload must all round-trip
  // untouched — this wrapper must never reshape a response it does not understand.
  const reference = { results: [{ ticker: "AAPL" }] };
  assert.equal(stampPolygonAggregatePayload("/v3/reference/tickers", reference), reference);
  const empty = { status: "OK", results: [] };
  assert.equal(stampPolygonAggregatePayload("/v2/aggs/ticker/X/range/1/day/a/b", empty), empty);
  assert.equal(stampPolygonAggregatePayload("/v2/aggs/ticker/X/range/1/day/a/b", null), null);
  assert.equal(stampPolygonAggregatePayload("/v2/aggs/ticker/X/range/1/day/a/b", 7), 7);
});

test("over the cap the payload says it was capped instead of quietly going unstamped", () => {
  const results = Array.from({ length: MAX_STAMPED_BARS + 1 }, (_, i) => ({
    t: Date.UTC(2020, 0, 1) + i * 86_400_000,
    c: i,
  }));
  const out = stampPolygonAggregatePayload(
    "/v2/aggs/ticker/I:SPX/range/1/day/2020-01-01/2026-08-20",
    { results }
  ) as { results: Array<{ session_date?: string }>; session_date_note?: string };
  assert.equal(out.results[0].session_date, undefined, "bars stay unstamped over the cap");
  assert.match(String(out.session_date_note), /exceeds the 750-bar stamping cap/);
  assert.match(String(out.session_date_note), /2019-12-31 to 2022-01-19 ET/);
});
