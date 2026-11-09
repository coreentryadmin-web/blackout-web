import { test } from "node:test";
import assert from "node:assert/strict";
import { settledFinancialsOrThrow } from "./financials-bundle-core";

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: "rejected", reason };
}

test("settledFinancialsOrThrow: THE BUG — all-5-rejected used to be cacheable as 'no data'; now throws instead", () => {
  // RED (pre-fix) description: the old code wrapped each of these five with its own
  // `.catch(() => null | [])` BEFORE Promise.all, so an all-rejected scenario like this one
  // produced {ratios:null, income:[], balance:[], cashFlow:[], priceTarget:null} — a value
  // indistinguishable from a genuinely-empty-but-successful read, and `serverCache` would have
  // cached it for the full 1h TTL. Post-fix, the same inputs must throw instead.
  const allRejected: [
    PromiseSettledResult<number | null>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<number | null>,
  ] = [
    rejected(new Error("ratios: upstream 503")),
    rejected(new Error("income: timeout")),
    rejected(new Error("balance: timeout")),
    rejected(new Error("cashFlow: timeout")),
    rejected(new Error("priceTarget: rate limited")),
  ];

  assert.throws(
    () => settledFinancialsOrThrow(allRejected, "nighthawk:financials:TEST"),
    /all 5 upstream calls failed/
  );
});

test("settledFinancialsOrThrow: one success among five failures is a genuine partial result, not a total outage", () => {
  const mostlyRejected: [
    PromiseSettledResult<number | null>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<number | null>,
  ] = [
    fulfilled(42),
    rejected(new Error("income: timeout")),
    rejected(new Error("balance: timeout")),
    rejected(new Error("cashFlow: timeout")),
    rejected(new Error("priceTarget: rate limited")),
  ];

  const result = settledFinancialsOrThrow(mostlyRejected, "nighthawk:financials:TEST");
  assert.deepEqual(result, { ratios: 42, income: [], balance: [], cashFlow: [], priceTarget: null });
});

test("settledFinancialsOrThrow: all-success is unchanged from today's behavior", () => {
  const allOk: [
    PromiseSettledResult<number | null>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<number | null>,
  ] = [fulfilled(7), fulfilled(["inc"]), fulfilled(["bal"]), fulfilled(["cf"]), fulfilled(100)];

  const result = settledFinancialsOrThrow(allOk, "nighthawk:financials:TEST");
  assert.deepEqual(result, { ratios: 7, income: ["inc"], balance: ["bal"], cashFlow: ["cf"], priceTarget: 100 });
});

test("settledFinancialsOrThrow: a genuinely-empty-but-successful read (new ticker, no statements) is NOT mistaken for an outage", () => {
  // Distinguishes "upstream answered with nothing" (legitimate, cacheable) from "upstream never
  // answered at all" (the bug this fix targets) — fulfilled-with-empty must never throw.
  const emptyButFulfilled: [
    PromiseSettledResult<number | null>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<string[]>,
    PromiseSettledResult<number | null>,
  ] = [fulfilled(null), fulfilled([]), fulfilled([]), fulfilled([]), fulfilled(null)];

  const result = settledFinancialsOrThrow(emptyButFulfilled, "nighthawk:financials:TEST");
  assert.deepEqual(result, { ratios: null, income: [], balance: [], cashFlow: [], priceTarget: null });
});
