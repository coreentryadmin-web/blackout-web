import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  formatAdvContextLine,
  formatGexContextLine,
  estimateDarkpoolShareSize,
  getTickerAdv20d,
} from "./discord-context-enrichment.ts";

// Regression: getTickerAdv20d fetches a 35-calendar-day window of daily bars and used to pass an
// explicit limit="25" to fetchStockDailyBars (polygon.ts), which fetches with `sort=asc`. A
// 35-calendar-day window almost always contains 25-26 real trading sessions (5 weeks x 5
// weekdays, +1 more occurrence of whatever weekday the window's END date falls on — and since this
// is only ever called during live RTH, that end date is always a weekday), so a hard cap of 25
// with ascending sort silently returns the OLDEST 25 sessions and drops the NEWEST one(s) — the
// exact "Polygon aggregate limit must be derived from the window, never fixed" trap this repo has
// hit before (see CLAUDE.md's "Data-correctness notes learned"). That is backwards for a live
// Discord ADV context line, which exists specifically to describe how a print compares to RECENT
// volume. mock.module() resolves bare/aliased specifiers relative to THIS file, not through the
// "@/" tsconfig alias (see src/lib/__tests__/critical-api-routes.test.ts), so the mock path below
// is relative, not "@/lib/providers/polygon".
mock.module("./providers/polygon", {
  namedExports: {
    fetchStockDailyBars: async (
      _symbol: string,
      _from: string,
      _to: string,
      limit?: string
    ): Promise<Array<{ v: number }>> => {
      // 26 ascending (oldest-first) daily bars, standing in for a real 35-day/26-session window.
      // The most recent session (last index) carries a real volume spike — exactly the session a
      // live alert's ADV context line most needs reflected in the average.
      const bars: Array<{ v: number }> = Array.from({ length: 26 }, () => ({ v: 1_000_000 }));
      bars[25] = { v: 100_000_000 };
      // Mirrors fetchStockDailyBars' real sort=asc + limit behavior: a smaller cap keeps only the
      // first (oldest) N of an ascending-sorted result, cutting off the newest end.
      return typeof limit === "string" ? bars.slice(0, Number(limit)) : bars;
    },
  },
});

test("formatGexContextLine shows nearest level distance", () => {
  const line = formatGexContextLine(740, {
    flip: 720,
    call_wall: 750,
    put_wall: 700,
  });
  assert.match(line ?? "", /call wall \(750\)/);
  assert.match(line ?? "", /below/);
});

test("formatGexContextLine returns null without levels", () => {
  assert.equal(formatGexContextLine(100, { flip: null, call_wall: null, put_wall: null }), null);
});

test("formatAdvContextLine computes share pct of ADV", () => {
  const line = formatAdvContextLine(500_000, 10_000_000);
  assert.match(line ?? "", /5\.0% of 20D/);
});

test("formatAdvContextLine promotes an ADV that rounds to 1000K into 1.0M, never an overflowed label", () => {
  assert.match(formatAdvContextLine(500_000, 999_950) ?? "", /~1\.0M ADV/);
  assert.match(formatAdvContextLine(500_000, 999_999) ?? "", /~1\.0M ADV/);
  assert.match(formatAdvContextLine(500_000, 1_000_000) ?? "", /~1\.0M ADV/);
  assert.match(formatAdvContextLine(5_000, 999_499) ?? "", /~999K ADV/);
});

test("estimateDarkpoolShareSize derives from premium and price", () => {
  assert.equal(estimateDarkpoolShareSize({ premium: 1_000_000, price: 100, share_size: null }), 10_000);
});

test("getTickerAdv20d includes the most recent trading session instead of truncating it off", async () => {
  const adv = await getTickerAdv20d("ZZDISCORDADVNOTRUNC");
  assert.ok(adv !== null, "expected a numeric ADV, not null");
  // If the most recent (spike) session had been dropped by an over-tight limit, every surviving
  // bar would be 1,000,000 and adv would equal exactly that. Including all 26 bars pulls the
  // average well above it (true average ≈ 4.81M).
  assert.ok(
    adv! > 2_000_000,
    `expected the most recent session's volume to be included in the average, got ${adv}`
  );
});
