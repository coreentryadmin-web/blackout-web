import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

/**
 * These exercise the two properties that keep the sector grid from flooding the server: a new
 * preset ABORTS the previous batch, and an already-warm ticker is not re-fetched at all. Both are
 * about the dropdown, where a member changes preset far faster than a heatmap build completes.
 */

type Store = Record<string, string>;

const store: Store = {};
const fetched: string[] = [];
const aborted: string[] = [];

// jsdom-free stubs: the module only needs `window`, `sessionStorage` and `fetch` to exist.
const g = globalThis as unknown as {
  window?: unknown;
  sessionStorage?: unknown;
  fetch?: unknown;
};

/** Resolvers for the in-flight fetches, so a test can decide when (or whether) each lands. */
let pending: Array<{ ticker: string; resolve: (v: unknown) => void }> = [];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  fetched.length = 0;
  aborted.length = 0;
  pending = [];

  g.sessionStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  g.window = { sessionStorage: g.sessionStorage };

  g.fetch = (url: string, init?: { signal?: AbortSignal }) => {
    const ticker = new URL(url, "https://x.test").searchParams.get("ticker") ?? "";
    fetched.push(ticker);
    return new Promise((resolve, reject) => {
      pending.push({
        ticker,
        resolve: (v) => resolve({ ok: true, json: async () => v }),
      });
      init?.signal?.addEventListener("abort", () => {
        aborted.push(ticker);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  };
});

afterEach(() => {
  delete g.window;
  delete g.sessionStorage;
  delete g.fetch;
});

test("a new preset aborts the previous batch's in-flight requests", async () => {
  const { prefetchGexHeatmapTickers, __test_resetGexHeatmapPrefetch } = await import(
    "./gex-heatmap-prefetch.ts"
  );
  __test_resetGexHeatmapPrefetch();

  prefetchGexHeatmapTickers(["NVDA", "AMD", "AVGO"]);
  assert.deepEqual(fetched, ["NVDA", "AMD", "AVGO"]);
  assert.deepEqual(aborted, []);

  // Member moves the dropdown to another sector before the first batch lands.
  prefetchGexHeatmapTickers(["XOM", "CVX"]);
  assert.deepEqual(aborted.sort(), ["AMD", "AVGO", "NVDA"]);
  assert.deepEqual(fetched.slice(3), ["XOM", "CVX"]);

  __test_resetGexHeatmapPrefetch();
});

test("an already-warm ticker is not re-fetched", async () => {
  const { writeGexHeatmapSessionCache } = await import("./gex-heatmap-session-cache.ts");
  const { prefetchGexHeatmapTickers, __test_resetGexHeatmapPrefetch } = await import(
    "./gex-heatmap-prefetch.ts"
  );
  __test_resetGexHeatmapPrefetch();

  writeGexHeatmapSessionCache("NVDA", { available: true });
  prefetchGexHeatmapTickers(["NVDA", "AMD"]);

  assert.deepEqual(fetched, ["AMD"], "warm NVDA must not spend a request");

  __test_resetGexHeatmapPrefetch();
});
