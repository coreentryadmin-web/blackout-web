import test from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  netPremiumLeaders,
  routeBreakdown,
  expiryConcentration,
  sessionFlowSkew,
} from "./helix-tape-analytics";

const alerts: FlowAlert[] = [
  {
    ticker: "NVDA",
    premium: 2_000_000,
    option_type: "CALL",
    strike: 900,
    expiry: "2026-08-15",
    route: "SWEEP",
    alert_rule: "RepeatedHitsSweep",
    score: 80,
    direction: "bullish",
    alerted_at: "2026-08-12T15:00:00Z",
    dte: 3,
  },
  {
    ticker: "NVDA",
    premium: 500_000,
    option_type: "PUT",
    strike: 880,
    expiry: "2026-08-15",
    route: "BLOCK",
    alert_rule: "RepeatedHitsBlock",
    score: 60,
    direction: "bearish",
    alerted_at: "2026-08-12T15:01:00Z",
    dte: 3,
  },
  {
    ticker: "SPY",
    premium: 1_500_000,
    option_type: "CALL",
    strike: 640,
    expiry: "2026-08-12",
    route: "SWEEP",
    alert_rule: "RepeatedHitsSweep",
    score: 70,
    direction: "bullish",
    alerted_at: "2026-08-12T15:02:00Z",
    dte: 0,
  },
];

test("netPremiumLeaders ranks by total premium", () => {
  const rows = netPremiumLeaders(alerts);
  assert.equal(rows[0]?.ticker, "NVDA");
  assert.equal(rows[0]?.total, 2_500_000);
});

test("routeBreakdown aggregates SWEEP vs BLOCK", () => {
  const rows = routeBreakdown(alerts);
  const sweep = rows.find((r) => r.route === "SWEEP");
  assert.ok(sweep);
  assert.equal(sweep!.count, 2);
});

test("expiryConcentration groups by expiry date", () => {
  const rows = expiryConcentration(alerts);
  assert.ok(rows.some((r) => r.expiry.startsWith("2026-08-15")));
});

test("sessionFlowSkew computes call pct", () => {
  const skew = sessionFlowSkew(alerts);
  assert.equal(skew.alert_count, 3);
  assert.ok(skew.call_pct >= 50 && skew.call_pct <= 100);
});

// ── Expiry horizon / session-anchor guards ───────────────────────────────────
// Regression cover for the defect where `expiry_concentration` ranked RAW EXPIRY DATES by
// premium, kept the top 8, and so dropped the 0DTE bucket entirely on a normal tape while
// handing the model bare date strings with no session to measure them against.

import {
  expiryHorizonConcentration,
  expiryHorizonLabel,
  EXPIRY_HORIZONS,
} from "./helix-tape-analytics";

/** Build a print with an explicit dte — the field the tape's SQL supplies. */
function print(over: Partial<FlowAlert> & { dte: number; premium: number }): FlowAlert {
  return {
    ticker: "AAA",
    option_type: "CALL",
    strike: 100,
    expiry: "2026-01-01",
    route: "SWEEP",
    alert_rule: "Sweep",
    score: 10,
    direction: "bullish",
    alerted_at: "2026-08-20T15:00:00Z",
    ...over,
  } as FlowAlert;
}

test("expiryHorizonLabel matches the member panel's buckets", () => {
  assert.equal(expiryHorizonLabel(0), "0DTE");
  assert.equal(expiryHorizonLabel(1), "This week");
  assert.equal(expiryHorizonLabel(7), "This week");
  assert.equal(expiryHorizonLabel(8), "Monthly");
  assert.equal(expiryHorizonLabel(30), "Monthly");
  assert.equal(expiryHorizonLabel(31), "LEAPS");
});

test("expiryHorizonLabel folds an ALREADY-EXPIRED print into 0DTE, not 'This week'", () => {
  // SQL returns expiry - ET_today, which goes negative for an expired row. The panel's
  // `dte === 0` test sends those to the `<= 7` branch, filing an expired contract under a
  // FUTURE horizon. Anything <= 0 belongs at the near end.
  assert.equal(expiryHorizonLabel(-1), "0DTE");
  assert.equal(expiryHorizonLabel(-30), "0DTE");
});

test("0DTE survives even when it is the SMALLEST bucket — the truncation bug", () => {
  // Live shape, 2026-08-20: one small 0DTE bucket against far-dated whale blocks. Under the
  // old top-8-by-premium-over-raw-dates aggregation the 0DTE row ranked 16th of 24 and never
  // reached the model.
  const alerts = [
    print({ dte: 0, premium: 40_000, expiry: "2026-08-20" }),
    ...Array.from({ length: 12 }, (_, i) =>
      print({ dte: 60 + i * 30, premium: 10_000_000, expiry: `2027-0${(i % 9) + 1}-15` })
    ),
  ];
  const horizons = expiryHorizonConcentration(alerts);
  const zero = horizons.find((h) => h.horizon === "0DTE");
  assert.ok(zero, "0DTE bucket must be present however small");
  assert.equal(zero!.premium, 40_000);
  assert.equal(zero!.count, 1);
  // At most four buckets exist, so the horizon view is never truncated.
  assert.ok(horizons.length <= EXPIRY_HORIZONS.length);
});

test("horizon buckets come back in chronological order, not premium order", () => {
  const rows = expiryHorizonConcentration([
    print({ dte: 200, premium: 9_000_000 }),
    print({ dte: 0, premium: 1_000 }),
    print({ dte: 3, premium: 5_000 }),
  ]);
  assert.deepEqual(rows.map((r) => r.horizon), ["0DTE", "This week", "LEAPS"]);
});

test("horizon buckets carry the call/put split the panel shows", () => {
  const rows = expiryHorizonConcentration([
    print({ dte: 0, premium: 750_000, option_type: "CALL" }),
    print({ dte: 0, premium: 250_000, option_type: "PUT" }),
  ]);
  assert.equal(rows[0]?.call_premium, 750_000);
  assert.equal(rows[0]?.put_premium, 250_000);
  assert.equal(rows[0]?.call_pct, 75);
});

test("a horizon with no measurable premium reports call_pct null, never a 50/50 balance", () => {
  // gap-#6: a typeless print counts toward neither side. It is still a print, so `count` is 1
  // and `premium` is 0 — and an unmeasurable skew must not read to the model as "balanced".
  const rows = expiryHorizonConcentration([
    print({ dte: 0, premium: 3_000_000, option_type: "UNKNOWN" }),
  ]);
  assert.equal(rows[0]?.count, 1);
  assert.equal(rows[0]?.premium, 0);
  assert.equal(rows[0]?.call_pct, null);
});

test("expiryConcentration rows carry dte + horizon so no date has to be inferred", () => {
  const rows = expiryConcentration([
    print({ dte: 0, premium: 1_000_000, expiry: "2026-08-20" }),
    print({ dte: 1, premium: 9_000_000, expiry: "2026-08-21" }),
  ]);
  const today = rows.find((r) => r.expiry === "2026-08-20");
  const tomorrow = rows.find((r) => r.expiry === "2026-08-21");
  assert.equal(today?.dte, 0);
  assert.equal(today?.horizon, "0DTE");
  // The bigger, nearer-LOOKING row is the NEXT session — the exact confusion the field removes.
  assert.equal(tomorrow?.dte, 1);
  assert.equal(tomorrow?.horizon, "This week");
});

test("expiryConcentration falls back to ET-anchored daysToExpiry when the row has no dte", () => {
  // 2026-08-21T01:00Z is still 2026-08-20 in ET, so an 08-20 expiry is 0DTE, not -1/expired.
  const now = new Date("2026-08-21T01:00:00Z");
  const rows = expiryConcentration(
    [{ ...print({ dte: 0, premium: 1_000, expiry: "2026-08-20" }), dte: undefined }],
    8,
    now
  );
  assert.equal(rows[0]?.dte, 0);
  assert.equal(rows[0]?.horizon, "0DTE");
});

test("empty tape produces no horizons rather than a fabricated bucket", () => {
  assert.deepEqual(expiryHorizonConcentration([]), []);
});

// ── Tape window coverage guards ──────────────────────────────────────────────
// Regression cover for reporting a REQUESTED window as if it were the analysed period. Live
// 2026-08-20 a 168-hour request with limit 500 returned 500 rows spanning 54 minutes.

import { tapeWindowCoverage } from "./helix-tape-analytics";

/** A print with a REAL UW time. `event_at` is what flowEventTimeMs trusts; `alerted_at` alone
 *  is only trusted when the row is NOT tape_time_estimated. */
function atPrint(alerted_at: string, premium = 1_000): FlowAlert {
  return {
    ticker: "AAA", option_type: "CALL", strike: 1, expiry: "2026-08-20",
    route: "SWEEP", alert_rule: "Sweep", score: 1, direction: "bullish",
    premium, alerted_at, event_at: alerted_at || null, dte: 0,
  } as FlowAlert;
}

/** A print UW gave no time for — `alerted_at` is INGEST time and the row says so. The desk
 *  excludes these from freshness; so must we. */
function ingestStampedPrint(alerted_at: string, premium = 1_000): FlowAlert {
  return { ...atPrint(alerted_at, premium), event_at: null, tape_time_estimated: true } as FlowAlert;
}

test("actual_hours is the span of the PRINTS, not the requested window", () => {
  const rows = [
    atPrint("2026-08-20T19:55:00Z"),
    atPrint("2026-08-20T20:49:00Z"),
  ];
  const w = tapeWindowCoverage(rows, 168, 500, new Date("2026-08-20T20:50:00Z"));
  assert.equal(w.requested_hours, 168);
  assert.equal(w.actual_minutes, 54);
  assert.ok(Math.abs(w.actual_hours! - 0.9) < 1e-9);
  assert.notEqual(w.actual_hours, w.requested_hours);
});

test("limit_reached flags a limit-bound read so the window is not quoted as the period", () => {
  const rows = Array.from({ length: 500 }, (_, i) =>
    atPrint(new Date(Date.parse("2026-08-20T20:00:00Z") + i * 1000).toISOString())
  );
  assert.equal(tapeWindowCoverage(rows, 168, 500).limit_reached, true);
  assert.equal(tapeWindowCoverage(rows.slice(0, 499), 168, 500).limit_reached, false);
});

test("newest_age_minutes exposes an off-hours tape that is complete but stale", () => {
  const w = tapeWindowCoverage(
    [atPrint("2026-08-20T20:49:00Z")],
    168, 500,
    new Date("2026-08-21T00:49:00Z")
  );
  assert.equal(w.newest_age_minutes, 240);
});

test("timestampless prints are counted out, never silently widening the span", () => {
  // UW sends some prints with no time; the REST read surfaces '' rather than fabricating one.
  const w = tapeWindowCoverage(
    [atPrint("2026-08-20T20:00:00Z"), atPrint(""), atPrint("2026-08-20T20:30:00Z")],
    168, 500
  );
  assert.equal(w.prints, 3);
  assert.equal(w.undated_prints, 1);
  assert.equal(w.actual_hours, 0.5);
});

test("an empty tape reports a null span, not a zero-hour one", () => {
  const w = tapeWindowCoverage([], 168, 500);
  assert.equal(w.actual_hours, null);
  assert.equal(w.oldest_print, null);
  assert.equal(w.prints, 0);
  // 0 rows against a 500 limit is genuinely window-bound, not limit-bound.
  assert.equal(w.limit_reached, false);
});

test("an ingest-stamped print never dates the tape — it is not a print time", () => {
  // Live 2026-08-20: 438 of 500 prints were tape_time_estimated. Reading alerted_at made the
  // tape look 282 minutes old against the desk's 309 — 27 minutes fresher than it was.
  const w = tapeWindowCoverage(
    [ingestStampedPrint("2026-08-20T20:49:00Z")],
    168, 500,
    new Date("2026-08-21T01:00:00Z")
  );
  assert.equal(w.actual_hours, null, "no real print time -> no span");
  assert.equal(w.newest_print, null);
  assert.equal(w.prints, 1);
  assert.equal(w.undated_prints, 1);
});

test("freshness is measured off the real print time, not the ingest fallback", () => {
  const w = tapeWindowCoverage(
    [
      atPrint("2026-08-20T20:00:00Z"),              // real print, 1h before the ingest row
      ingestStampedPrint("2026-08-20T20:49:00Z"),   // newer, but ingest-stamped
    ],
    168, 500,
    new Date("2026-08-20T21:00:00Z")
  );
  // 60 minutes off the REAL print, not 11 off the ingest stamp.
  assert.equal(w.newest_age_minutes, 60);
  assert.equal(w.timed_prints, 1);
  assert.equal(w.undated_prints, 1);
  assert.equal(w.prints, 2);
});

test("timed_prints vs prints exposes how much of the tape cannot be dated", () => {
  const w = tapeWindowCoverage(
    [atPrint("2026-08-20T20:00:00Z"), ...Array.from({ length: 9 }, () => ingestStampedPrint("2026-08-20T20:30:00Z"))],
    168, 500
  );
  assert.equal(w.prints, 10);
  assert.equal(w.timed_prints, 1);
  assert.equal(w.undated_prints, 9);
});

test("a SHORT burst never reports zero hours — rounding must not fabricate 'no span'", () => {
  // Coordinator review of #2428: actual_hours was rounded to 1dp inside the compute path, so any
  // span under 3 minutes became exactly 0 — and the tool description tells the model to quote
  // that field as the period analysed, i.e. "over 0 hours" for a 90-second burst of 500 prints.
  // Reachable at limit:120 (mini-panel, desk-scope-prefetch) and on any "right now" limit.
  const rows = [atPrint("2026-08-20T20:00:00Z"), atPrint("2026-08-20T20:01:30Z")];
  const w = tapeWindowCoverage(rows, 168, 2);
  assert.notEqual(w.actual_hours, 0, "a real 90s span must not read as zero hours");
  assert.ok(w.actual_hours! > 0);
  assert.equal(w.actual_minutes, 2);
});

test("every window field is PRESENT on an empty tape, not absent", () => {
  // tool-defs instructs the model to read window.newest_age_minutes; dropping the key on the
  // branch that most needs it makes the instruction unfollowable.
  const w = tapeWindowCoverage([], 168, 500) as Record<string, unknown>;
  for (const k of ["requested_hours","actual_hours","actual_minutes","oldest_print","newest_print",
                   "newest_age_minutes","no_dated_print_reason","prints","timed_prints",
                   "undated_prints","limit_reached"]) {
    assert.ok(k in w, `${k} must be present`);
  }
  assert.equal(w.newest_age_minutes, null);
  assert.equal(w.no_dated_print_reason, "no_prints_in_window");
});

test("prints with no exchange time report WHY there is no span", () => {
  const w = tapeWindowCoverage(
    [ingestStampedPrint("2026-08-20T20:00:00Z"), ingestStampedPrint("2026-08-20T20:30:00Z")],
    168, 500
  );
  assert.equal(w.prints, 2);
  assert.equal(w.timed_prints, 0);
  assert.equal(w.actual_hours, null);
  // "all_prints_undated" is a different fact from "no prints at all" and must not read as it.
  assert.equal(w.no_dated_print_reason, "all_prints_undated");
});
