// Real BEHAVIOR test for computeRelativeVolumeShadow's wiring (fetch → cache → assemble), mocking
// the Polygon fetch layer and the shared cache per node:test's --experimental-test-module-mocks so
// the real date-windowing/grouping/caching logic runs, not just a regex check against the source.
// Same mock.module convention as benzinga-earnings-pagination.test.ts (relative specifier, not the
// "@/..." alias — tsx's alias rewrite only applies to statically-parsed top-level imports).
import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

type DailyBar = { v: number };
type MinuteBar = { t: number; v: number };

let dailyBarsResponse: DailyBar[] = [];
let minuteBarsResponses: Record<string, MinuteBar[]> = {}; // keyed by `${ticker}:${from}:${to}`
let dailyBarsCallCount = 0;
let minuteBarsCallCount = 0;
let dailyBarsShouldThrow = false;
let minuteBarsShouldThrow = false;

mock.module("../providers/polygon", {
  namedExports: {
    fetchStockDailyBars: async (_ticker: string, _from: string, _to: string) => {
      dailyBarsCallCount++;
      if (dailyBarsShouldThrow) throw new Error("polygon daily bars failed");
      return dailyBarsResponse;
    },
    fetchStockMinuteBars: async (ticker: string, from: string, to: string) => {
      minuteBarsCallCount++;
      if (minuteBarsShouldThrow) throw new Error("polygon minute bars failed");
      return minuteBarsResponses[`${ticker}:${from}:${to}`] ?? minuteBarsResponses[ticker] ?? [];
    },
  },
});

const cacheStore = new Map<string, unknown>();
mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGetWithTtl: async (key: string) =>
      cacheStore.has(key) ? { value: cacheStore.get(key), remainingTtlSec: 3600 } : null,
    sharedCacheSet: async (key: string, value: unknown) => {
      cacheStore.set(key, value);
    },
  },
});

let computeRelativeVolumeShadow: typeof import("./relative-volume-source.ts").computeRelativeVolumeShadow;
before(async () => {
  ({ computeRelativeVolumeShadow } = await import("./relative-volume-source.ts"));
});

const etMs = (dateIso: string, h: number, m = 0) =>
  Date.parse(`${dateIso}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`); // UTC-4 (EDT)

function minuteBarsForDay(dateIso: string, perMinuteVolume: number): MinuteBar[] {
  const bars: MinuteBar[] = [];
  const open = Date.parse(`${dateIso}T13:30:00Z`);
  for (let i = 0; i < 390; i++) {
    bars.push({ t: open + i * 60_000, v: perMinuteVolume });
  }
  return bars;
}

beforeEach(() => {
  dailyBarsResponse = [];
  minuteBarsResponses = {};
  dailyBarsCallCount = 0;
  minuteBarsCallCount = 0;
  dailyBarsShouldThrow = false;
  minuteBarsShouldThrow = false;
  cacheStore.clear();
});

test("computeRelativeVolumeShadow: assembles a real baseline + candidate read when all fetches succeed", async () => {
  dailyBarsResponse = new Array(20).fill({ v: 10_000_000 });
  // Today's partial-day bars (used for cumulative volume), plus several prior full days
  // (used to build the time-of-day profile) — all real, flat-paced for a clean assertion.
  const today = "2026-10-19";
  minuteBarsResponses[`TSLA:${today}:${today}`] = minuteBarsForDay(today, 25_000).slice(0, 180); // half the day so far
  // The profile fetch covers a 12-day lookback window ending today; supply flat-paced prior days.
  const priorDays = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"];
  let allPriorBars: MinuteBar[] = [];
  for (const d of priorDays) allPriorBars = allPriorBars.concat(minuteBarsForDay(d, 25_000));
  minuteBarsResponses["TSLA"] = allPriorBars; // fallback key used by the profile-window fetch

  const nowMs = etMs(today, 12, 30); // 180 minutes elapsed
  const result = await computeRelativeVolumeShadow("TSLA", nowMs);

  assert.ok(result != null);
  assert.equal(result!.avg_daily_volume, 10_000_000);
  assert.ok(result!.baseline.ratio != null);
  assert.equal(result!.baseline.expected_fraction_source, "flat_proration");
  // A flat historical pace means the candidate profile's shape matches flat proration closely —
  // both baseline and candidate should read close to the same ratio for a genuinely flat-paced name.
  assert.ok(result!.candidate.ratio != null);
  assert.equal(result!.profile_days_used, 6);
});

test("computeRelativeVolumeShadow: a cached profile is reused, not re-fetched", async () => {
  dailyBarsResponse = new Array(20).fill({ v: 5_000_000 });
  const today = "2026-10-19";
  minuteBarsResponses[`NVDA:${today}:${today}`] = minuteBarsForDay(today, 10_000).slice(0, 60);
  const nowMs = etMs(today, 10, 30);

  cacheStore.set(`zerodte:rvol:profile:NVDA:${today}`, null); // cached "no profile" verdict from an earlier pass

  await computeRelativeVolumeShadow("NVDA", nowMs);
  const callsAfterFirst = minuteBarsCallCount;
  await computeRelativeVolumeShadow("NVDA", nowMs);
  // The profile lookback fetch must not have run a second time — only today's cumulative-volume
  // fetch (a different call) runs each time.
  assert.equal(minuteBarsCallCount, callsAfterFirst + 1, "second call should only re-fetch today's cumulative volume, not the cached profile");
});

test("computeRelativeVolumeShadow: returns null (never throws, never fabricates) when the daily-bars fetch fails", async () => {
  dailyBarsShouldThrow = true;
  const today = "2026-10-19";
  minuteBarsResponses[`SPY:${today}:${today}`] = minuteBarsForDay(today, 1_000);
  const result = await computeRelativeVolumeShadow("SPY", etMs(today, 11, 0));
  assert.equal(result, null);
});

test("computeRelativeVolumeShadow: returns null when today's cumulative-volume fetch fails, even if daily bars succeed", async () => {
  dailyBarsResponse = new Array(20).fill({ v: 1_000_000 });
  minuteBarsShouldThrow = true;
  const result = await computeRelativeVolumeShadow("QQQ", etMs("2026-10-19", 11, 0));
  assert.equal(result, null);
});
