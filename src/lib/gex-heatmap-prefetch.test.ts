import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";

/**
 * Batch prefetch: a new preset ABORTS the previous batch, and warm tickers are skipped.
 */

const store = new Map<string, string>();
const fetched: string[] = [];
const aborted: string[] = [];

const g = globalThis as unknown as {
  window?: unknown;
  sessionStorage?: unknown;
  fetch?: unknown;
};

let pendingResolve: ((v: unknown) => void) | null = null;

beforeEach(() => {
  store.clear();
  fetched.length = 0;
  aborted.length = 0;
  pendingResolve = null;

  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  g.window = { sessionStorage: g.sessionStorage };

  g.fetch = (url: string, init?: { signal?: AbortSignal }) => {
    fetched.push(url);
    return new Promise((resolve, reject) => {
      pendingResolve = (v) => resolve({ ok: true, json: async () => v });
      init?.signal?.addEventListener("abort", () => {
        aborted.push(url);
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

test("a new preset aborts the previous batch request", async () => {
  const { prefetchGexHeatmapTickers, __test_resetGexHeatmapPrefetch } = await import(
    "./gex-heatmap-prefetch.ts"
  );
  __test_resetGexHeatmapPrefetch();

  prefetchGexHeatmapTickers(["NVDA", "AMD", "AVGO"]);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0]!, /batch\?tickers=NVDA%2CAMD%2CAVGO/);

  prefetchGexHeatmapTickers(["XOM", "CVX"]);
  assert.equal(aborted.length, 1);
  assert.equal(fetched.length, 2);
  assert.match(fetched[1]!, /batch\?tickers=XOM%2CCVX/);

  __test_resetGexHeatmapPrefetch();
});

test("an already-warm ticker is not included in the batch", async () => {
  const { writeGexHeatmapSessionCache } = await import("./gex-heatmap-session-cache.ts");
  const { prefetchGexHeatmapTickers, __test_resetGexHeatmapPrefetch } = await import(
    "./gex-heatmap-prefetch.ts"
  );
  __test_resetGexHeatmapPrefetch();

  writeGexHeatmapSessionCache("NVDA", { available: true, spot: 100, strikes: [100], expiries: ["2026-07-28"] });
  prefetchGexHeatmapTickers(["NVDA", "AMD"]);

  assert.equal(fetched.length, 1);
  assert.match(fetched[0]!, /batch\?tickers=AMD/);
  assert.doesNotMatch(fetched[0]!, /NVDA/);

  __test_resetGexHeatmapPrefetch();
});

test("batch response seeds session cache per ticker", async () => {
  const { readGexHeatmapSessionCache } = await import("./gex-heatmap-session-cache.ts");
  const { prefetchGexHeatmapTickers, __test_resetGexHeatmapPrefetch } = await import(
    "./gex-heatmap-prefetch.ts"
  );
  __test_resetGexHeatmapPrefetch();

  prefetchGexHeatmapTickers(["AMD"]);
  assert.ok(pendingResolve);
  pendingResolve!({
    tickers: {
      AMD: { available: true, spot: 150, strikes: [150], expiries: ["2026-07-28"] },
    },
  });
  await new Promise((r) => setTimeout(r, 0));

  const cached = readGexHeatmapSessionCache("AMD") as { spot?: number } | undefined;
  assert.equal(cached?.spot, 150);

  __test_resetGexHeatmapPrefetch();
});
