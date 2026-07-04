import assert from "node:assert/strict";
import { before, describe, test, mock } from "node:test";

// Regression: fetchRecentLargoAnswersWithResults() is the new cron-readable, cross-user reader
// that closes largo-verifier.ts's coverage gap (previously no way to enumerate real Largo
// answers with their tool_results outside a single session+user). Verify it filters to
// assistant rows with non-null tool_results, and correctly rejects null/missing rows.

let capturedSql = "";
let capturedParams: unknown[] = [];
let mockRows: Array<{ id: number; content: string; tool_results: unknown; created_at: Date }> = [];

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    dbQuery: async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: mockRows, rowCount: mockRows.length };
    },
    dbClient: async () => {
      throw new Error("dbClient should not be called by fetchRecentLargoAnswersWithResults");
    },
  },
});

describe("largo-store: fetchRecentLargoAnswersWithResults", () => {
  let fetchRecentLargoAnswersWithResults: typeof import("./largo-store").fetchRecentLargoAnswersWithResults;

  before(async () => {
    ({ fetchRecentLargoAnswersWithResults } = await import("./largo-store"));
  });

  test("queries only assistant rows with non-null tool_results", async () => {
    mockRows = [];
    await fetchRecentLargoAnswersWithResults(25);
    assert.match(capturedSql, /role = 'assistant'/);
    assert.match(capturedSql, /tool_results IS NOT NULL/);
    assert.deepEqual(capturedParams, [25]);
  });

  test("maps rows into the RecentLargoAnswer shape, defaulting non-array tool_results to []", async () => {
    const createdAt = new Date("2026-07-04T12:00:00.000Z");
    mockRows = [
      { id: 7, content: "SPX at 5900.", tool_results: [{ spot: 5900 }], created_at: createdAt },
      { id: 8, content: "Fallback row.", tool_results: null, created_at: createdAt },
    ];
    const rows = await fetchRecentLargoAnswersWithResults(25);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].tool_results, [{ spot: 5900 }]);
    assert.deepEqual(rows[1].tool_results, []);
    assert.equal(rows[0].created_at, createdAt.toISOString());
  });

  test("defaults to limit 50 when called with no argument", async () => {
    mockRows = [];
    await fetchRecentLargoAnswersWithResults();
    assert.deepEqual(capturedParams, [50]);
  });
});
