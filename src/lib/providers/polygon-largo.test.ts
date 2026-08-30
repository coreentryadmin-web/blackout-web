import assert from "node:assert/strict";
import { test, mock } from "node:test";

// polygonGet() (polygon-largo.ts) checks polygonConfigured() — Boolean(process.env.POLYGON_API_KEY)
// — BEFORE ever calling polygonTrackedFetch, and short-circuits to null when it reads false. CI's
// unit-test environment carries no real Polygon key, so without this fixture both tests below fail
// closed (bar is null, capturedInit is never set) despite the mock being wired correctly — caught
// live: this file passed locally (a real POLYGON_API_KEY was already set in that shell) and failed
// in CI. Same hermetic-fixture pattern largo-terminal.test.ts uses for ANTHROPIC_API_KEY.
process.env.POLYGON_API_KEY = "test-hermetic-fixture-key";

// Mutable stub, same pattern as polygon-options-gex.test.ts: mock.module runs once at import
// time, so a per-test swap of the captured behavior (not a re-mock) is how each test drives a
// different response through the SAME dynamic-import-resolved module.
let capturedInit: RequestInit | null = null;
let responseBody: unknown = { results: [{ t: 1, o: 1, h: 1, l: 1, c: 100, v: 1 }] };

mock.module("./polygon-rate-limiter", {
  namedExports: {
    isPolygonCircuitOpen: () => false,
    polygonTrackedFetch: async (_endpointKey: string, _url: string, init?: RequestInit) => {
      capturedInit = init ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => responseBody,
      } as Response;
    },
  },
});

// Lazy dynamic import (not top-level await, and not a static import): the mocks above must be
// registered before polygon-largo.ts's own static imports resolve, and each test calls this to
// get the module — same pattern as gex-regime-events.test.ts's `const mod = () => import(...)`.
const mod = () => import("./polygon-largo");

// The exact regression #3187 shipped but did not actually fix: a nested no-store fetch inside
// the marketing homepage's last-resort GEX spot path forces Next to abandon `revalidate = 3600`
// and render "/" fully dynamic on every request. #3187's own regression test only grepped the
// SOURCE TEXT for the call shape (`fetchPreviousDayBar(symbol, { next: { revalidate: 3600 } })`)
// — it never inspected the actual merged fetch options `fetchPreviousDayBar` sends downstream,
// so it could not catch that `cache: "no-store"` was still present alongside `next.revalidate`,
// which is exactly what kept the bug live in production after the "fix" merged and deployed.

test("fetchPreviousDayBar with a next.revalidate override does NOT also set cache: no-store", async () => {
  capturedInit = null;
  responseBody = { results: [{ t: 1, o: 1, h: 1, l: 1, c: 187.4, v: 1 }] };

  const { fetchPreviousDayBar } = await mod();
  const bar = await fetchPreviousDayBar("SPY", { next: { revalidate: 3600 } });

  assert.ok(bar, "the call must still succeed");
  assert.equal(bar!.c, 187.4);
  assert.ok(capturedInit, "polygonTrackedFetch must have been called");
  assert.deepEqual(capturedInit!.next, { revalidate: 3600 }, "the revalidate override must reach the real fetch");
  assert.equal(
    "cache" in capturedInit! ? capturedInit!.cache : undefined,
    undefined,
    "cache must be ABSENT (not just falsy) when next.revalidate is requested — Next.js treats " +
      "cache and next.revalidate as mutually exclusive, and cache wins if both are set"
  );
});

test("fetchPreviousDayBar with no override still defaults to cache: no-store (unchanged for every other caller)", async () => {
  capturedInit = null;
  responseBody = { results: [{ t: 1, o: 1, h: 1, l: 1, c: 100, v: 1 }] };

  const { fetchPreviousDayBar } = await mod();
  await fetchPreviousDayBar("SPY");

  assert.ok(capturedInit);
  assert.equal(capturedInit!.cache, "no-store");
  assert.equal(capturedInit!.next, undefined, "no next override was requested, so none should appear");
});
