/**
 * Regression: `isMonthlyExpiry` must holiday-roll the third Friday, the same way the real listed
 * monthly options contract does.
 *
 * THE BUG. The function tested `d === firstFriday + 14` with no holiday adjustment. Swept
 * 2024-2028, exactly two third Fridays are market holidays (both Juneteenth): 2026-06-19 and
 * 2027-06-18 (see `src/features/nighthawk/lib/session.ts`'s `US_MARKET_HOLIDAYS`, the shared
 * source of truth already used server-side by `meridian-timeline.ts`'s `monthlyExpiryYmd` for
 * the identical problem — see that file's own header for the live-caught Polygon/pin-accuracy
 * incident this is the same defect class as).
 *
 * Equity/index options can never expire on a day the market is closed, so the REAL listed
 * contract for June 2026 settles 2026-06-18 (the preceding trading day), not the raw third
 * Friday 2026-06-19 — and that IS the date Polygon serves on the matrix's expiry axis. The old
 * `isMonthlyExpiry("2026-06-18")` returned false for it: the column lost its gold far-dated
 * tint, dropped out of `monthlyExpiries` (undercounting the "Monthly" horizon preset), and was
 * folded into `nearExpiries` instead — diluting the walls/flip/net-GEX levels served under the
 * "Near" horizon filter with the dominant OpEx column that filter exists to exclude.
 *
 * This test extracts the real `thirdFridayYmdClient` / `monthlyExpiryYmdClient` /
 * `isMonthlyExpiry` function bodies verbatim from the component source (so it cannot silently
 * drift from the shipped logic) and executes them against the REAL `isTradingDayEt` (the same
 * shared holiday calendar production reads), rather than a hand-written mirror.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/thermal/components/GexHeatmap-monthly-expiry-holiday.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";

const src = readFileSync(join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"), "utf8");

/** Extracts a function's source between its declaration and the FIRST top-level `}` that closes it. */
function extractFunctionSource(signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start > 0, `function not found: ${signature}`);
  const end = src.indexOf("\n}", start);
  assert.ok(end > start, `closing brace not found for: ${signature}`);
  return src.slice(start, end + 2);
}

/**
 * The only TS-only tokens in these three function bodies are parameter/return type annotations
 * and one `as [number, number, number]` cast — stripped so `new Function` can parse the result
 * as plain JS. Everything else (control flow, the holiday-roll loop under test) is executed
 * verbatim from the real source.
 */
function stripTsTypes(s: string): string {
  return s
    .replace(/ as \[number, number, number\]/g, "")
    .replace(/: number/g, "")
    .replace(/: string/g, "")
    .replace(/: boolean/g, "");
}

/**
 * Builds the three real functions as executable JS, chained through `new Function` so
 * `isMonthlyExpiry` calls the REAL `monthlyExpiryYmdClient`/`thirdFridayYmdClient` extracted
 * from the same source, not a reimplementation. `isTradingDayEt` is injected as a parameter
 * (the real imported one), since the component source references it as a free variable (import).
 */
function buildIsMonthlyExpiry(): (ymd: string) => boolean {
  const thirdFriday = extractFunctionSource("function thirdFridayYmdClient(");
  const monthlyExpiry = extractFunctionSource("function monthlyExpiryYmdClient(");
  const isMonthly = extractFunctionSource("function isMonthlyExpiry(");
  const body = stripTsTypes([thirdFriday, monthlyExpiry, isMonthly, "return isMonthlyExpiry;"].join("\n\n"));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- extracting real source, not user input
  const factory = new Function("isTradingDayEt", body);
  return factory(isTradingDayEt);
}

const isMonthlyExpiry = buildIsMonthlyExpiry();

test("GexHeatmap: isMonthlyExpiry holiday-rolls 2026-06-19 Juneteenth to the real listed expiry 2026-06-18", () => {
  assert.equal(isMonthlyExpiry("2026-06-18"), true, "the REAL listed June 2026 monthly contract settles 06-18");
  assert.equal(isMonthlyExpiry("2026-06-19"), false, "06-19 is Juneteenth — the market is closed, nothing expires");
});

test("GexHeatmap: isMonthlyExpiry holiday-rolls 2027-06-18 Juneteenth (observed) to 2027-06-17", () => {
  // 2027's raw third Friday (06-18) IS the observed Juneteenth holiday itself (06-19 falls on a
  // Saturday), so the real listed contract rolls back one trading day further, to 06-17.
  assert.equal(isMonthlyExpiry("2027-06-17"), true, "the REAL listed June 2027 monthly contract settles 06-17");
  assert.equal(isMonthlyExpiry("2027-06-18"), false, "06-18 is the observed Juneteenth holiday — nothing expires");
  assert.equal(isMonthlyExpiry("2027-06-19"), false, "06-19 is a Saturday");
});

test("GexHeatmap: isMonthlyExpiry still matches an ordinary (non-holiday) third Friday unchanged", () => {
  assert.equal(isMonthlyExpiry("2026-01-16"), true, "ordinary third Friday of Jan 2026");
  assert.equal(isMonthlyExpiry("2026-01-15"), false, "the day before is not the expiry");
  assert.equal(isMonthlyExpiry("2026-01-23"), false, "the following Friday (4th) is not the expiry");
});

test("GexHeatmap: isMonthlyExpiry is tolerant of malformed input", () => {
  assert.equal(isMonthlyExpiry(""), false);
  assert.equal(isMonthlyExpiry("not-a-date"), false);
});
