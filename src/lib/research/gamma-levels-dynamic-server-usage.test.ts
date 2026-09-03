import assert from "node:assert/strict";
import { test, mock } from "node:test";

// Regression for a P2 finding (2026-09-03, docs/audit/findings-staging/
// 2026-09-03-research-gamma-levels-dynamic-server-usage-cache-poison.md) flagging that
// research/gamma-levels/[ticker] has the SAME "swallow-then-cache" shape #3383 fixed on the
// homepage: this page is ISR (`revalidate`, no `dynamic = "force-dynamic"`), and its
// `loadWindowBars` calls Polygon through `polygonGet`, whose fetch is `cache: "no-store"`. Firing
// that from a page Next is still trying to render STATICALLY trips Next's `DynamicServerError`
// bailout — framework control flow that must propagate, not a real fetch failure. The pre-fix
// `try/catch` swallowed it identically to a real Polygon outage and cached the resulting empty
// bars for 1 hour (CACHE_TTL_SEC), poisoning the page for every visitor in that window.
//
// This proves the fix directly: `loadWindowBars`'s catch must re-throw a DynamicServerError
// (identified by `err.digest === "DYNAMIC_SERVER_USAGE"`, the real value Next.js 15 stamps —
// confirmed against the installed `next` package, not assumed) while still swallowing (and
// logging) any other error exactly as before.

mock.module("server-only", { namedExports: {} });

const state = {
  fetchError: null as Error | null,
  dbConfigured: false,
};

// Mocked via relative specifiers, which tsx resolves to the SAME file URLs as gamma-levels.ts's
// own `@/...` alias imports, so the mock registry keys match (same convention as
// gex-positioning.test.ts).
mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    dbQuery: async () => ({ rows: [] }),
  },
});

mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async () => undefined,
  },
});

mock.module("../providers/polygon", {
  namedExports: {
    fetchIndexDailyBars: async () => {
      if (state.fetchError) throw state.fetchError;
      return [];
    },
    fetchStockDailyBars: async () => {
      if (state.fetchError) throw state.fetchError;
      return [];
    },
  },
});

const mod = () => import("./gamma-levels.ts");

test("loadGammaLevelsResearch re-throws a DynamicServerError instead of caching a poisoned empty result", async () => {
  const { loadGammaLevelsResearch } = await mod();
  const dynamicServerError = new Error("Dynamic server usage: Route /research/gamma-levels/SPX...");
  (dynamicServerError as unknown as { digest: string }).digest = "DYNAMIC_SERVER_USAGE";
  state.fetchError = dynamicServerError;

  await assert.rejects(
    () => loadGammaLevelsResearch("SPX"),
    (err: unknown) => err === dynamicServerError,
    "the DynamicServerError instance must propagate unchanged, not be swallowed into an empty result"
  );
});

test("loadGammaLevelsResearch still swallows a genuine Polygon failure and returns a valid (empty-bars) result", async () => {
  const { loadGammaLevelsResearch } = await mod();
  state.fetchError = new Error("Polygon 500 Internal Server Error");

  const research = await loadGammaLevelsResearch("SPX");
  assert.ok(research, "a real upstream failure must still degrade gracefully, not throw");
});
