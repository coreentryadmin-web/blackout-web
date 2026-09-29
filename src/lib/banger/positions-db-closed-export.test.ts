import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Ask Largo standing mandate, 2026-09-25: fetchBangerClosedExportRows is the data source for the
// Engine B discovery-edge study (scripts/audit/banger-discovery-edge-analysis.mjs). Proves the SQL
// shape: closed statuses only, filtered on closed_at (outcome time, not entry time) since the
// caller's date, ascending order, and a bounded LIMIT that defaults generously but is overridable —
// mock.module() resolves relative to THIS file, same pattern as positions-db-open-book-limit.test.ts.

let lastQuery: { sql: string; params: unknown[] } | null = null;

mock.module("../db.ts", {
  namedExports: {
    dbQuery: async (sql: string, params: unknown[] = []) => {
      lastQuery = { sql, params };
      return { rows: [] };
    },
    isoDateString: (d: unknown) => String(d),
    isoTimestampString: (d: unknown) => String(d),
    toJsonbParam: (v: unknown) => v,
  },
});

describe("fetchBangerClosedExportRows query shape", () => {
  let fetchBangerClosedExportRows: (since: string, limit?: number) => Promise<unknown[]>;

  before(async () => {
    ({ fetchBangerClosedExportRows } = await import("./positions-db.ts"));
  });

  test("filters to closed statuses only, orders by closed_at ASC (chronological for a time-series study)", async () => {
    lastQuery = null;
    await fetchBangerClosedExportRows("2026-08-04T00:00:00.000Z");
    assert.ok(lastQuery, "dbQuery must have been called");
    assert.match(lastQuery!.sql, /status IN \('CLOSED_RUNNER','STOPPED'\)/);
    assert.match(lastQuery!.sql, /ORDER BY closed_at ASC/);
  });

  test("filters on closed_at (outcome time), not session_date/committed_at (entry time)", async () => {
    lastQuery = null;
    await fetchBangerClosedExportRows("2026-08-04T00:00:00.000Z");
    assert.match(lastQuery!.sql, /closed_at >= \$1/);
    assert.doesNotMatch(lastQuery!.sql, /session_date >=/);
  });

  test("default limit is generous (5000) and overridable", async () => {
    lastQuery = null;
    await fetchBangerClosedExportRows("2026-08-04T00:00:00.000Z");
    assert.deepEqual(lastQuery!.params, ["2026-08-04T00:00:00.000Z", 5000]);

    lastQuery = null;
    await fetchBangerClosedExportRows("2026-08-04T00:00:00.000Z", 10);
    assert.deepEqual(lastQuery!.params, ["2026-08-04T00:00:00.000Z", 10]);
  });
});
