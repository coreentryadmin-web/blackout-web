import assert from "node:assert/strict";
import { test, mock, before, beforeEach } from "node:test";

// REAL BEHAVIOR test for fetchPolygonMacroBackdrop's per-leg failure handling — mocking
// polygonTrackedFetch/config/server-cache per node:test's --experimental-test-module-mocks so the
// actual Promise.all + cache-write-decision logic runs for real, not just a regex check against
// the source. Kept in a SEPARATE file from polygon-macro.test.ts (which statically imports the
// pure parse/build helpers at module top level) because mock.module() must run before anything
// resolves the target module's dependency graph — a static top-level import of "./polygon-macro"
// in the same file would already have loaded the real ./polygon-rate-limiter and ../server-cache
// before any mock.module() call here could take effect. Same established pattern as
// benzinga-earnings-pagination.test.ts / meridian-benzinga-earnings.test.ts.

// polygonConfigured() reads POLYGON_API_KEY live; macroGet() throws "POLYGON_API_KEY not set"
// before ever calling polygonTrackedFetch if this isn't set, which would make every case below
// look like a "fetch failed" case for the wrong reason.
process.env.POLYGON_API_KEY = "test-polygon-key";
process.env.POLYGON_API_BASE = "https://api.massive.com";

type FetchOutcome =
  | { kind: "ok"; results: Array<Record<string, unknown>> }
  | { kind: "fail"; status: number };

const REAL_TREASURY_ROW = { date: "2026-07-10", yield_1_year: 4.1, yield_10_year: 4.35 };
const REAL_INFLATION_ROW = { date: "2026-06-30", cpi: 321.5 };

let treasuryOutcome: FetchOutcome = { kind: "ok", results: [REAL_TREASURY_ROW] };
let inflationOutcome: FetchOutcome = { kind: "ok", results: [REAL_INFLATION_ROW] };

// Relative specifier, not the "@/..." alias — tsx's alias rewrite only applies to statically-
// parsed top-level `import ... from` statements, not to mock.module()'s specifier string.
mock.module("./polygon-rate-limiter", {
  namedExports: {
    polygonTrackedFetch: async (_endpointKey: string, url: string): Promise<Response> => {
      const outcome = url.includes("/fed/v1/treasury-yields") ? treasuryOutcome : inflationOutcome;
      if (outcome.kind === "fail") {
        return { status: outcome.status, ok: false, json: async () => ({}) } as Response;
      }
      return { status: 200, ok: true, json: async () => ({ results: outcome.results }) } as Response;
    },
  },
});

mock.module("./config", {
  namedExports: {
    polygonConfigured: () => true,
  },
});

// Bypass the real cache entirely so each test observes the compute function's own return/throw —
// i.e. whether this call WOULD be cached — not a previous run's cached result. Same pattern as
// meridian-benzinga-earnings.test.ts / zerodte/scan.test.ts.
mock.module("../server-cache", {
  namedExports: {
    serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    TTL: { REFERENCE: 3_600_000 },
  },
});

let fetchPolygonMacroBackdrop: typeof import("./polygon-macro").fetchPolygonMacroBackdrop;

before(async () => {
  ({ fetchPolygonMacroBackdrop } = await import("./polygon-macro"));
});

beforeEach(() => {
  treasuryOutcome = { kind: "ok", results: [REAL_TREASURY_ROW] };
  inflationOutcome = { kind: "ok", results: [REAL_INFLATION_ROW] };
});

test("a genuine inflation fetch FAILURE (500) is never cached as a confirmed-empty CPI leg", async () => {
  // Treasury succeeds with real data; inflation's own fetch genuinely fails (not "no rows this
  // period" — the upstream call itself 500s). Regression for the bug: the old code's
  // `.catch(() => ({ results: [] }))` made this indistinguishable from "CPI has nothing to
  // report", so it got built into a non-null backdrop and returned (meaning serverCache's real
  // wrapper would pin it for a full hour with inflation falsely nulled).
  inflationOutcome = { kind: "fail", status: 500 };
  const result = await fetchPolygonMacroBackdrop();
  assert.equal(result, null, "a one-sided fetch failure must not produce a cacheable result");
});

test("a genuine treasury fetch FAILURE (429) is never cached as a confirmed-empty yields leg", async () => {
  // Symmetric case — the bug applied to either leg, not just inflation.
  treasuryOutcome = { kind: "fail", status: 429 };
  const result = await fetchPolygonMacroBackdrop();
  assert.equal(result, null, "a one-sided fetch failure must not produce a cacheable result");
});

test("both legs failing still returns null (pre-existing behavior, unaffected)", async () => {
  treasuryOutcome = { kind: "fail", status: 500 };
  inflationOutcome = { kind: "fail", status: 500 };
  const result = await fetchPolygonMacroBackdrop();
  assert.equal(result, null);
});

test("a leg that genuinely succeeds with ZERO rows is still returned+cached with that leg nulled", async () => {
  // Legitimate partial state (e.g. CPI not yet printed this period) — the fetch itself succeeded
  // (200, empty results), so this is NOT a failure and must keep working exactly as designed:
  // the intentional partial-cache behavior this fix must not regress.
  inflationOutcome = { kind: "ok", results: [] };
  const result = await fetchPolygonMacroBackdrop();
  assert.ok(result, "a genuinely-empty (not failed) leg must still produce a cacheable partial result");
  assert.equal(result?.treasury.date, "2026-07-10");
  assert.equal(result?.inflation.cpi, null);
  assert.equal(result?.inflation.date, null);
});

test("both legs genuinely empty (not failed) still returns null (pre-existing total-miss guard)", async () => {
  treasuryOutcome = { kind: "ok", results: [] };
  inflationOutcome = { kind: "ok", results: [] };
  const result = await fetchPolygonMacroBackdrop();
  assert.equal(result, null);
});

test("both legs succeeding with real data returns the full backdrop", async () => {
  const result = await fetchPolygonMacroBackdrop();
  assert.ok(result);
  assert.equal(result?.treasury.date, "2026-07-10");
  assert.equal(result?.inflation.cpi, 321.5);
});
