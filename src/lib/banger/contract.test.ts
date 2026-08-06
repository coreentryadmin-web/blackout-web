import { test } from "node:test";
import assert from "node:assert/strict";
import { strikeIncrement, pickBangerContract, type FetchBarsFn } from "./contract.ts";
import type { AggBar } from "@/lib/providers/polygon-largo";

test("strikeIncrement matches the market-banger-scan.mjs ladder", () => {
  assert.equal(strikeIncrement(10), 0.5);
  assert.equal(strikeIncrement(24.99), 0.5);
  assert.equal(strikeIncrement(25), 1);
  assert.equal(strikeIncrement(99), 1);
  assert.equal(strikeIncrement(100), 2.5);
  assert.equal(strikeIncrement(249), 2.5);
  assert.equal(strikeIncrement(250), 5);
  assert.equal(strikeIncrement(500), 5);
});

function fixtureBars(entryClose: number): AggBar[] {
  const entryT = Date.parse("2026-08-04T13:30:00Z");
  return [
    { t: entryT, o: entryClose, h: entryClose * 1.1, l: entryClose * 0.9, c: entryClose, v: 100 },
    { t: entryT + 86_400_000, o: entryClose, h: entryClose * 2.5, l: entryClose * 0.5, c: entryClose * 2, v: 100 },
  ];
}

test("pickBangerContract picks the first OTM multiple with usable bar data", async () => {
  const calls: string[] = [];
  const fetchBars: FetchBarsFn = async (occ) => {
    calls.push(occ);
    // Only the 5% OTM strike (first tried) has data.
    if (occ.includes("C00105000")) return fixtureBars(1.5);
    return [];
  };
  const pick = await pickBangerContract("ANET", 100, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars);
  assert.ok(pick, "expected a contract pick");
  assert.equal(pick!.ticker, "ANET");
  assert.equal(pick!.strike, 105); // 100 * 1.05, rounded to the $1 increment for a $100 spot
  assert.equal(pick!.entryPremium, 1.5);
  assert.equal(calls.length, 1, "stops probing after the first hit");
});

test("pickBangerContract falls through OTM multiples on empty bars, then gives up", async () => {
  let calls = 0;
  const fetchBars: FetchBarsFn = async () => {
    calls += 1;
    return [];
  };
  const pick = await pickBangerContract("NOPE", 50, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars);
  assert.equal(pick, null);
  assert.ok(calls >= 1 && calls <= 4, "tries up to the 4 OTM multiples");
});

test("pickBangerContract rejects a trivially-priced entry bar (<= $0.02)", async () => {
  const fetchBars: FetchBarsFn = async () => fixtureBars(0.01);
  const pick = await pickBangerContract("PENNY", 20, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars);
  assert.equal(pick, null);
});

test("pickBangerContract is fail-soft on a fetch error for one strike, tries the next", async () => {
  let attempt = 0;
  const fetchBars: FetchBarsFn = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("upstream 500");
    return fixtureBars(2.25);
  };
  const pick = await pickBangerContract("RETRY", 60, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars);
  assert.ok(pick);
  assert.equal(pick!.entryPremium, 2.25);
});

test("pickBangerContract returns null for a non-positive spot", async () => {
  const fetchBars: FetchBarsFn = async () => fixtureBars(2);
  assert.equal(await pickBangerContract("BAD", 0, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars), null);
  assert.equal(await pickBangerContract("BAD", -5, "2026-08-14", "2026-08-04", "2026-08-13", fetchBars), null);
});
