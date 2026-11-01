import test from "node:test";
import assert from "node:assert/strict";
import { fetchVectorEmbedFastSeed } from "./vector-client-seed";

/**
 * Regression test for a missing-normalization bug in `fetchVectorEmbedFastSeed`: every sibling
 * call site that checks `VECTOR_ORACLE_TICKERS.has(...)` (vector-cadence.ts, vector-snapshot.ts,
 * vector-wall-sample.ts, vector-wall-sample-server.ts, vector-rail-bootstrap.ts) normalizes the
 * ticker FIRST — this one did not, so a non-canonical ticker (lowercase, or a Polygon-style
 * `I:SPX` deep-link key) that is genuinely SPX/SPY/QQQ silently skipped the oracle rail-bootstrap
 * fetch, degrading the fast first-paint bead rail to empty for no real reason. Same bug shape the
 * repo already fixed once for `normalizeDteHorizon` (see that function's own doc comment).
 */

type RecordedCall = { url: string };

function withMockFetch(
  responses: Record<string, unknown>,
  run: (calls: RecordedCall[]) => Promise<void>
): Promise<void> {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push({ url });
    let body: unknown = {};
    for (const [needle, payload] of Object.entries(responses)) {
      if (url.includes(needle)) {
        body = payload;
        break;
      }
    }
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

test("fetchVectorEmbedFastSeed fetches the oracle rail-bootstrap for a lowercase oracle ticker", async () => {
  await withMockFetch(
    {
      "/vector/bars": { bars: [], sessionYmd: "2026-11-01" },
      "/vector/walls": { walls: null, flip: null },
      "/vector/rail-bootstrap": { blended: [], narrowed: [] },
    },
    async (calls) => {
      await fetchVectorEmbedFastSeed("spy");
      const hitRailBootstrap = calls.some((c) => c.url.includes("/rail-bootstrap"));
      assert.ok(
        hitRailBootstrap,
        `expected a rail-bootstrap fetch for a lowercase oracle ticker, got: ${calls.map((c) => c.url).join(", ")}`
      );
    }
  );
});

test("fetchVectorEmbedFastSeed fetches the oracle rail-bootstrap for an I:-prefixed oracle ticker", async () => {
  await withMockFetch(
    {
      "/vector/bars": { bars: [], sessionYmd: "2026-11-01" },
      "/vector/walls": { walls: null, flip: null },
      "/vector/rail-bootstrap": { blended: [], narrowed: [] },
    },
    async (calls) => {
      await fetchVectorEmbedFastSeed("I:SPX");
      const hitRailBootstrap = calls.some((c) => c.url.includes("/rail-bootstrap"));
      assert.ok(
        hitRailBootstrap,
        `expected a rail-bootstrap fetch for an I:-prefixed oracle ticker, got: ${calls.map((c) => c.url).join(", ")}`
      );
    }
  );
});

test("fetchVectorEmbedFastSeed still skips the rail-bootstrap for a genuine non-oracle ticker", async () => {
  await withMockFetch(
    {
      "/vector/bars": { bars: [], sessionYmd: "2026-11-01" },
      "/vector/walls": { walls: null, flip: null },
      "/vector/rail-bootstrap": { blended: [], narrowed: [] },
    },
    async (calls) => {
      await fetchVectorEmbedFastSeed("nvda");
      const hitRailBootstrap = calls.some((c) => c.url.includes("/rail-bootstrap"));
      assert.equal(hitRailBootstrap, false, "a non-oracle ticker must never hit the oracle-only rail-bootstrap route");
    }
  );
});
