import { test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// Regression for a P2 finding (2026-09-02, live monitor): touchDynamicUniverse used to pin ANY
// syntactically valid ticker into the shared, cron-recorded dynamic universe on first view — a
// one-time typo ("NFLIX" for NFLX) got stuck there permanently, since nothing checked whether the
// symbol resolves to real options data. The 5-min recorder cron then kept re-warming a name that
// would never produce one, and every member's /api/market/vector/universe served a permanent dead
// row. This proves the fix: a ticker with no real spot from fetchGexHeatmap is never written to
// the shared map, while a real one still is.
//
// FOLLOW-UP (same day): the first version of this fix (#3348) and this test both modeled an
// "unresolvable ticker" as fetchGexHeatmap returning `null`. That is not what production actually
// does. `fetchGexHeatmap`'s real contract (polygon-options-gex.ts) is to return a fully-formed
// `GexHeatmap` with `spot: 0` (via `emptyHeatmap()`) for a syntactically valid ticker it cannot
// price — `spot` is typed `number`, never `number | null`. `fetchGexHeatmap` itself only resolves
// to `null`/throws on a TOTAL failure (Polygon not configured, or the root can't even be parsed).
// The mock below now mirrors that real shape (`spot: 0`, not a `null` return) so this suite
// actually exercises the bug the live monitor found: the first fix's `hm?.spot == null` guard
// never caught a `spot: 0` payload, so the exact "typo pinned forever" incident kept recurring
// through the "fixed" code. `spotByTicker` unset now means "resolves with spot 0", matching
// production; a distinct `unreachableTickers` set models the true total-failure (null) case.

mock.module("server-only", { namedExports: {} });

const staticTickers = ["SPY", "SPX", "QQQ"];
let genericCache = new Map<string, unknown>();
let fetchCalls: string[] = [];
/** Ticker -> spot the mocked fetchGexHeatmap should return; absent = resolves with spot: 0
 *  (production's real "no chain for this ticker" shape — see comment above). */
let spotByTicker = new Map<string, number>();
/** Tickers for which fetchGexHeatmap itself returns null (total fetch failure, not just no spot). */
let unreachableTickers = new Set<string>();

mock.module("../../../lib/heatmap-allowlist", {
  namedExports: {
    vectorUniverseTickers: () => staticTickers,
  },
});

mock.module("../../../lib/shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => genericCache.get(key) ?? null,
    sharedCacheSet: async (key: string, value: unknown) => {
      genericCache.set(key, value);
    },
  },
});

mock.module("../../../lib/providers/polygon-options-gex", {
  namedExports: {
    fetchGexHeatmap: async (ticker: string) => {
      fetchCalls.push(ticker);
      if (unreachableTickers.has(ticker)) return null; // total fetch failure
      const spot = spotByTicker.get(ticker) ?? 0; // real emptyHeatmap() shape: spot 0, never null
      return { spot, asof: new Date().toISOString(), gex: null, vex: null };
    },
  },
});

let touchDynamicUniverse: typeof import("./vector-dynamic-universe").touchDynamicUniverse;
let listDynamicUniverseTickers: typeof import("./vector-dynamic-universe").listDynamicUniverseTickers;

test.before(async () => {
  const mod = await import("./vector-dynamic-universe");
  touchDynamicUniverse = mod.touchDynamicUniverse;
  listDynamicUniverseTickers = mod.listDynamicUniverseTickers;
});

test("touchDynamicUniverse: a real, resolvable ticker is written to the shared dynamic universe", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map([["NFLX", 850.12]]);
  unreachableTickers = new Set();

  await touchDynamicUniverse("nflx");

  assert.deepEqual(fetchCalls, ["NFLX"]);
  const tickers = await listDynamicUniverseTickers();
  assert.deepEqual(tickers, ["NFLX"]);
});

// THE LIVE INCIDENT'S ACTUAL SHAPE. fetchGexHeatmap does not reject and does not return null for
// a dead/unknown-but-syntactically-valid ticker — it resolves with a fully-formed GexHeatmap whose
// `spot` is 0 (emptyHeatmap()'s real sentinel). A guard that only checks `== null` never sees this.
test("touchDynamicUniverse: a syntactically valid but unpriceable ticker (spot: 0, the real emptyHeatmap shape) is NEVER pinned", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map(); // NFLIX resolves with spot: 0 — same shape as the live incident
  unreachableTickers = new Set();

  await touchDynamicUniverse("NFLIX");

  assert.deepEqual(fetchCalls, ["NFLIX"], "must still attempt to resolve it once");
  const tickers = await listDynamicUniverseTickers();
  assert.deepEqual(
    tickers,
    [],
    "a resolved-but-unpriceable (spot: 0) symbol must never enter the shared map the cron re-warms forever"
  );
});

test("touchDynamicUniverse: a total fetchGexHeatmap failure (null / rejection) is treated the same as unpriceable, not a crash", async () => {
  genericCache = new Map();
  fetchCalls = [];
  spotByTicker = new Map();
  unreachableTickers = new Set(["BADTICK"]);

  const { touchDynamicUniverse: fresh } = await import("./vector-dynamic-universe");
  // Simulate a throwing/null-returning provider and confirm the outer try/catch in
  // touchDynamicUniverse means this never throws back to the caller either way.
  await assert.doesNotReject(fresh("BADTICK"));
  assert.deepEqual(await listDynamicUniverseTickers(), []);
});
