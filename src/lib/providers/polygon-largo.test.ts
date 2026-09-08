import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolygonLargoFetchInit, computeLevelsFromBars } from "./polygon-largo";

// Regression for #3187 / PR #3202: a trailing spread `{ cache: "no-store", ...fetchInit }` left
// `cache` in place when `fetchInit` only set `next.revalidate`, so Next's fetch patch ignored
// the ISR override. Test the pure builder — no mock.module (parallel full-suite runs load
// polygon-largo before per-file mocks register, which made the integration-style test flaky in CI).

test("buildPolygonLargoFetchInit: next.revalidate must not coexist with cache", () => {
  const init = buildPolygonLargoFetchInit({ next: { revalidate: 3600 } });
  assert.deepEqual(init.next, { revalidate: 3600 });
  assert.equal("cache" in init ? init.cache : undefined, undefined);
});

test("buildPolygonLargoFetchInit: default path still uses cache no-store", () => {
  const init = buildPolygonLargoFetchInit();
  assert.equal(init.cache, "no-store");
  assert.equal(init.next, undefined);
});

test("buildPolygonLargoFetchInit: explicit cache override when no next.revalidate", () => {
  const init = buildPolygonLargoFetchInit({ cache: "force-cache" });
  assert.equal(init.cache, "force-cache");
  assert.equal(init.next, undefined);
});

test("computeLevelsFromBars: includeVwap false omits multi-session VWAP", () => {
  const bars = [
    { o: 100, h: 102, l: 99, c: 101, v: 1_000_000 },
    { o: 101, h: 103, l: 100, c: 102, v: 2_000_000 },
  ];
  const withVwap = computeLevelsFromBars(bars, 102);
  const withoutVwap = computeLevelsFromBars(bars, 102, { includeVwap: false });
  assert.ok(withVwap.vwap != null);
  assert.equal(withoutVwap.vwap, null);
  assert.equal(withVwap.support, withoutVwap.support);
  assert.equal(withVwap.resistance, withoutVwap.resistance);
});
