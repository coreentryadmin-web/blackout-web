import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolygonLargoFetchInit } from "./polygon-largo";

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
