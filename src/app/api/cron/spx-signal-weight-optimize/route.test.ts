import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Regression coverage for the "?days=<empty|non-numeric>" NaN crash
// (docs/audit/findings-staging/2026-09-04-spx-signal-weight-optimize-nan-crash.md).
//
// URLSearchParams.get("days") returns the EMPTY STRING "" (not null) for a bare
// `?days` or `?days=`, so `?? String(DEFAULT_LOOKBACK_DAYS)` never falls back
// (`??` only fires on null/undefined) and `parseInt("", 10)` is NaN — same for
// any non-numeric value like `?days=abc`. Pre-fix, that NaN flowed straight into
// `new Date(Date.now() - NaN * ...).toISOString()`, which THROWS
// RangeError("Invalid time value") ABOVE this route's own try/catch — so the
// route rejects instead of returning a Response, and the crash is invisible to
// logCronRun/cron_job_runs. This test proves the route now returns a clean
// Response (falling back to the default lookback) instead of throwing.
//
// mock.module() resolves bare specifiers relative to THIS file (see
// src/app/api/cron/spx-issues-sync/route.test.ts for the same pattern) rather
// than the "@/" tsconfig alias.

let cronAuthorized = true;
let dbQueryCalls: string[] = [];
let loggedRuns: Array<{ jobKey: string; payload: Record<string, unknown> }> = [];
let insertWeightReportCalls: Array<{ lookbackDays: number }> = [];

mock.module("../../../../lib/market-api-auth", {
  namedExports: {
    isCronAuthorized: () => cronAuthorized,
  },
});
mock.module("../../../../lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
    // Every observation count comes back zero, so the route always takes the
    // early "Insufficient data" return — the whole point here is proving the
    // route reaches ANY dbQuery call at all without throwing first on the
    // `since` computation, not exercising the full report-building path.
    dbQuery: async (sql: string) => {
      dbQueryCalls.push(sql);
      return { rows: [{ total: "0", correct: "0" }] };
    },
  },
});
mock.module("../../../../lib/cron-run", {
  namedExports: {
    logCronRun: async (jobKey: string, _started: number, payload: Record<string, unknown>) => {
      loggedRuns.push({ jobKey, payload });
    },
  },
});
mock.module("../../../../features/spx/lib/spx-signal-db", {
  namedExports: {
    initSpxSignalTables: async () => {},
    insertWeightReport: async (lookbackDays: number) => {
      insertWeightReportCalls.push({ lookbackDays });
    },
  },
});

describe("GET /api/cron/spx-signal-weight-optimize", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("rejects unauthorized requests", async () => {
    cronAuthorized = false;
    const res = await GET(new NextRequest("http://localhost/api/cron/spx-signal-weight-optimize"));
    assert.equal(res.status, 401);
    cronAuthorized = true;
  });

  test("falls back to the default lookback instead of throwing on ?days= (empty string)", async () => {
    dbQueryCalls = [];
    loggedRuns = [];
    // On the pre-fix code this `await` rejects with RangeError("Invalid time
    // value") — the whole point of this test.
    const res = await GET(
      new NextRequest("http://localhost/api/cron/spx-signal-weight-optimize?days=")
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    // Proves the empty string fell back to DEFAULT_LOOKBACK_DAYS=30, not NaN.
    assert.match(String(body.reason), /last 30 days/);
    assert.ok(dbQueryCalls.length > 0, "route must reach the dbQuery call, not throw before it");
    assert.equal(loggedRuns.length, 1);
    assert.equal(loggedRuns[0].jobKey, "spx-signal-weight-optimize");
  });

  test("falls back to the default lookback instead of throwing on ?days=abc (non-numeric)", async () => {
    dbQueryCalls = [];
    loggedRuns = [];
    const res = await GET(
      new NextRequest("http://localhost/api/cron/spx-signal-weight-optimize?days=abc")
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    assert.match(String(body.reason), /last 30 days/);
    assert.ok(dbQueryCalls.length > 0, "route must reach the dbQuery call, not throw before it");
  });

  test("still honors a valid numeric ?days override (no regression)", async () => {
    dbQueryCalls = [];
    loggedRuns = [];
    const res = await GET(
      new NextRequest("http://localhost/api/cron/spx-signal-weight-optimize?days=5")
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    assert.match(String(body.reason), /last 5 days/);
  });

  test("bare ?days with no value also falls back cleanly", async () => {
    dbQueryCalls = [];
    loggedRuns = [];
    const res = await GET(
      new NextRequest("http://localhost/api/cron/spx-signal-weight-optimize?days")
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.match(String(body.reason), /last 30 days/);
  });
});
