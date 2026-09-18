import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpxPlayDeskContext } from "./spx-play-context";
import { mixedTapeBlockThreshold } from "./spx-play-gates";
import type { SpxDeskPayload } from "./spx-desk";

function baseDesk(): SpxDeskPayload {
  return {
    available: true,
    market_open: true,
    price: 5500,
    gamma_flip: 5490,
    max_pain: 5510,
    news_headlines: [],
    gex_walls: [],
    polled_at: new Date().toISOString(),
  } as SpxDeskPayload;
}

test("mixedTapeBlockThreshold: B-grade strong score gets +1 tolerance", () => {
  const weak = mixedTapeBlockThreshold("B", 48);
  const strong = mixedTapeBlockThreshold("B", 60);
  assert.equal(strong, weak + 1);
});

test("mixedTapeBlockThreshold: A-grade baseline above B", () => {
  assert.ok(mixedTapeBlockThreshold("A", 50) >= mixedTapeBlockThreshold("B", 50));
});

test("buildSpxPlayDeskContext: computes conflict meter and session budget", () => {
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    {
      score: 55,
      grade: "B",
      factors: [],
      direction: "long",
    },
    { session_entries_today: 2, session_losses_today: 1 }
  );
  assert.equal(ctx.session_entries_used, 2);
  assert.equal(ctx.session_losses_used, 1);
  assert.equal(ctx.suggested_option_type, "call");
  assert.ok(ctx.suggested_strike != null);
  assert.equal(ctx.gamma_flip_dist_pts, 10);
});

// Regression: Labor Day 2026-09-07 is a Monday (weekday) but an NYSE holiday — no
// session runs at all. Confirmed live via GET /api/market/spx/play that
// desk_context previously rendered live-looking countdowns anyway because the
// gate was isEtWeekday (weekday only, no holiday check). 14:21 ET is mid-RTH on
// an ordinary trading day, which is exactly why this date/time combination is
// the one that exposes the bug — any other weekday would pass even pre-fix.
test("buildSpxPlayDeskContext: NYSE holiday on a weekday nulls every countdown", () => {
  const laborDayAt1421Et = new Date("2026-09-07T18:21:00.000Z"); // 14:21 ET (EDT, UTC-4)
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    { score: -18, grade: "D", factors: [], direction: "short" },
    { session_entries_today: 0, session_losses_today: 0 },
    laborDayAt1421Et
  );
  assert.equal(ctx.minutes_to_close, null);
  assert.equal(ctx.minutes_to_no_entry, null);
  assert.equal(ctx.minutes_to_force_exit, null);
});

// Same wall-clock time on an ordinary trading day (Tuesday 2026-09-08) must still
// report live countdowns — proves the fix is holiday-specific, not a blanket null.
test("buildSpxPlayDeskContext: ordinary trading day at the same ET time still counts down", () => {
  const ordinaryTuesdayAt1421Et = new Date("2026-09-08T18:21:00.000Z");
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    { score: 55, grade: "B", factors: [], direction: "long" },
    { session_entries_today: 0, session_losses_today: 0 },
    ordinaryTuesdayAt1421Et
  );
  assert.notEqual(ctx.minutes_to_close, null);
  assert.ok((ctx.minutes_to_close ?? 0) > 0);
});
