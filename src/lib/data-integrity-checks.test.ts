import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const nowMs = Date.UTC(2026, 8, 4, 15, 0, 0); // 2026-09-04 11:00 ET (RTH)
const fiveMinAgo = new Date(nowMs - 5 * 60_000).toISOString();
const fiveMinFuture = new Date(nowMs + 5 * 60_000).toISOString();

mock.module("@/features/spx/lib/spx-desk-loader", {
  namedExports: {
    loadMergedSpxDesk: async () => ({
      merged: { market_open: true, available: false },
    }),
  },
});

mock.module("@/lib/providers/polygon", {
  namedExports: {
    fetchStockSnapshot: async () => null,
  },
});

let gexSpxAsof = fiveMinAgo;
let gexSpyAsof = fiveMinAgo;

mock.module("@/lib/providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async (ticker: string) => {
      if (ticker === "SPX") {
        return { spot: 5500, asof: gexSpxAsof, gex: { strike_totals: {} } };
      }
      if (ticker === "SPY") {
        return { spot: 550, asof: gexSpyAsof, gex: { strike_totals: {} } };
      }
      return null;
    },
  },
});

let runDataIntegrityChecks: () => Promise<{
  marketOpen: boolean;
  checked: number;
  issues: Array<{ title: string; detail: string }>;
}>;

before(async () => {
  const realDateNow = Date.now;
  Date.now = () => nowMs;
  const mod = await import("./data-integrity-checks");
  runDataIntegrityChecks = mod.runDataIntegrityChecks;
  Date.now = realDateNow;
});

test("C6 GEX freshness: recent asof passes (no stale issue)", async () => {
  gexSpxAsof = fiveMinAgo;
  gexSpyAsof = fiveMinAgo;
  const realDateNow = Date.now;
  Date.now = () => nowMs;
  const result = await runDataIntegrityChecks();
  Date.now = realDateNow;
  const stale = result.issues.filter((i) => i.title.includes("stale during RTH"));
  assert.equal(stale.length, 0, `expected no stale issues, got ${JSON.stringify(stale)}`);
});

test("C6 GEX freshness: future asof flags stale (not silently fresh)", async () => {
  gexSpxAsof = fiveMinFuture;
  gexSpyAsof = fiveMinAgo;
  const realDateNow = Date.now;
  Date.now = () => nowMs;
  const result = await runDataIntegrityChecks();
  Date.now = realDateNow;
  const spxStale = result.issues.find((i) => i.title === "GEX SPX stale during RTH");
  assert.ok(spxStale, "expected future-dated SPX asof to flag stale");
  assert.match(spxStale.detail, /future-dated|invalid/i);
});
