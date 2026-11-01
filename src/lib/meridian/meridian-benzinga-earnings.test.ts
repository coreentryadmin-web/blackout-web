import assert from "node:assert/strict";
import { test, mock } from "node:test";

// meridian-benzinga-earnings.ts pulls in a real `import "server-only"`, which throws under
// plain Node outside a Next.js server bundle. Stub it the same way the rest of the repo's
// tests do (see meridian-earnings-history.test.ts for the same pattern).
mock.module("server-only", { namedExports: {} });

// Bypass the cache entirely so each test observes the loader's own return value, not a
// previous run's cached result — same pattern as src/lib/zerodte/scan.test.ts.
mock.module("../server-cache", {
  namedExports: {
    serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  },
});

type FetchOutcome =
  | {
      kind: "resolve";
      value: { rows: unknown[]; entitled: boolean; error: string | null; truncated?: boolean };
    }
  | { kind: "reject"; message: string };

let structuredEarningsOutcome: FetchOutcome = {
  kind: "resolve",
  value: { rows: [], entitled: true, error: null },
};
let corporateGuidanceOutcome: FetchOutcome = {
  kind: "resolve",
  value: { rows: [], entitled: true, error: null },
};

async function runOutcome(outcome: FetchOutcome) {
  if (outcome.kind === "reject") throw new Error(outcome.message);
  return outcome.value;
}

mock.module("../providers/polygon", {
  namedExports: {
    fetchBenzingaAfterHoursMovers: async () => [],
    fetchBenzingaCorporateGuidance: async () => runOutcome(corporateGuidanceOutcome),
    fetchBenzingaNews: async () => [],
    fetchBenzingaStructuredEarnings: async () => runOutcome(structuredEarningsOutcome),
    parsePriceTargetFromText: () => null,
  },
});

mock.module("../db", {
  namedExports: {
    recordMeridianEstimateRevision: async () => undefined,
    readRecentMeridianEstimateRevisions: async () => [],
  },
});

const mod = () => import("./meridian-benzinga-earnings");

test("loadBenzingaBoardEarnings carries the real provider error instead of a generic string", async () => {
  // Regression: the 2026-08-18 Meridian enrichment outage fix (loadBenzingaTickerEarnings)
  // carried the real thrown message through its own .catch instead of a generic marker. This
  // sibling function in the same file still swallowed every network/fetch exception into the
  // literal string "cache_error" — same defect class, missed when the sibling was fixed.
  structuredEarningsOutcome = { kind: "reject", message: "upstream 503" };
  const { loadBenzingaBoardEarnings } = await mod();
  const res = await loadBenzingaBoardEarnings(["AAPL"], "2026-10-19", 7);
  assert.equal(res.rows.length, 0);
  assert.match(
    res.error ?? "",
    /upstream 503/,
    `expected the real provider error to be carried through, got: ${res.error}`
  );
  assert.notEqual(res.error, "cache_error", "must not collapse to the old generic marker");
});

test("loadBenzingaTickerGuidance carries the real provider error instead of a generic string", async () => {
  corporateGuidanceOutcome = { kind: "reject", message: "rate_limited" };
  const { loadBenzingaTickerGuidance } = await mod();
  const res = await loadBenzingaTickerGuidance("TGT");
  assert.equal(res.rows.length, 0);
  assert.match(
    res.error ?? "",
    /rate_limited/,
    `expected the real provider error to be carried through, got: ${res.error}`
  );
  assert.notEqual(res.error, "cache_error", "must not collapse to the old generic marker");
});

test("a provider soft-error (resolved with error set, not thrown) is also carried, not swallowed", async () => {
  // The provider can report a failure without rejecting (res.error set on a 200). The fixed
  // loadBenzingaTickerEarnings sibling explicitly throws on this so it is never cached as a
  // real empty answer; these two functions now do the same.
  structuredEarningsOutcome = {
    kind: "resolve",
    value: { rows: [], entitled: true, error: "entitlement_check_failed" },
  };
  const { loadBenzingaBoardEarnings } = await mod();
  const res = await loadBenzingaBoardEarnings(["AAPL"], "2026-10-19", 7);
  assert.match(res.error ?? "", /entitlement_check_failed/);
});

test("a genuinely empty (no error) result still returns cleanly for both functions", async () => {
  structuredEarningsOutcome = { kind: "resolve", value: { rows: [], entitled: true, error: null } };
  corporateGuidanceOutcome = { kind: "resolve", value: { rows: [], entitled: true, error: null } };
  const { loadBenzingaBoardEarnings, loadBenzingaTickerGuidance } = await mod();
  const board = await loadBenzingaBoardEarnings(["AAPL"], "2026-10-19", 7);
  const guidance = await loadBenzingaTickerGuidance("TGT");
  assert.equal(board.error, null);
  assert.equal(guidance.error, null);
});

// BUG FIX (2026-11-01, Ask Largo standing mandate, live repro QXO): loadBenzingaEarningsBundle's
// market-wide window fetch (fetchBenzingaStructuredEarnings({..., paginate: true})) can hit its
// own pagination safety cap with real rows still unfetched upstream — `window_truncated` is the
// signal that must reach every consumer (meridianCatalystSection/meridianPeerSection) so a ticker
// absent from `window_rows` is never misread as "this ticker has no catalyst in the window."
test("loadBenzingaEarningsBundle: forwards a truncated window fetch as window_truncated:true", async () => {
  structuredEarningsOutcome = {
    kind: "resolve",
    value: { rows: [], entitled: true, error: null, truncated: true },
  };
  const { loadBenzingaEarningsBundle } = await mod();
  const bundle = await loadBenzingaEarningsBundle("2026-11-01", 21);
  assert.equal(
    bundle.window_truncated,
    true,
    "a truncated window fetch must be forwarded as window_truncated:true, not silently dropped",
  );
});

test("loadBenzingaEarningsBundle: a complete window fetch reports window_truncated:false (no regression)", async () => {
  structuredEarningsOutcome = {
    kind: "resolve",
    value: { rows: [], entitled: true, error: null, truncated: false },
  };
  const { loadBenzingaEarningsBundle } = await mod();
  const bundle = await loadBenzingaEarningsBundle("2026-11-01", 21);
  assert.equal(bundle.window_truncated, false);
});

test("loadBenzingaEarningsBundle: a window fetch with no truncated field at all (single-page fetch shape) reports window_truncated:false", async () => {
  // fetchBenzingaStructuredEarnings never sets `truncated` on an early return (not asked to
  // paginate, or the first page already carried everything) — the field is simply absent, not
  // explicitly false. Must not be read as truthy.
  structuredEarningsOutcome = { kind: "resolve", value: { rows: [], entitled: true, error: null } };
  const { loadBenzingaEarningsBundle } = await mod();
  const bundle = await loadBenzingaEarningsBundle("2026-11-01", 21);
  assert.equal(bundle.window_truncated, false);
});
