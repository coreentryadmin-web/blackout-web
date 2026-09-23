import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// FIX (Ask Largo standing mandate, live-verified 2026-09-23): fetchBangerOpenBookRows previously
// defaulted `limit = 80` and every call site hardcoded `80` explicitly, so the real open banger
// book was silently truncated once true open positions exceeded 80 (measured live: 168 real open
// rows, only ~80-83 ever reaching the Swing Command board's `committed` array). This test proves
// the SQL itself carries NO `LIMIT` clause when the caller omits an explicit limit, and still
// respects an explicit limit when one is passed (callers that genuinely want a bounded page keep
// that option) — mock.module() resolves relative to THIS file.

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

describe("fetchBangerOpenBookRows limit handling", () => {
  let fetchBangerOpenBookRows: (limit?: number) => Promise<unknown[]>;

  before(async () => {
    ({ fetchBangerOpenBookRows } = await import("./positions-db.ts"));
  });

  test("no limit argument -> SQL carries no LIMIT clause (the real open book is never truncated)", async () => {
    lastQuery = null;
    await fetchBangerOpenBookRows();
    assert.ok(lastQuery, "dbQuery must have been called");
    assert.doesNotMatch(lastQuery!.sql, /LIMIT/i);
    assert.deepEqual(lastQuery!.params, []);
  });

  test("explicit limit -> SQL still carries a bounded LIMIT clause for callers that want a page", async () => {
    lastQuery = null;
    await fetchBangerOpenBookRows(5);
    assert.ok(lastQuery, "dbQuery must have been called");
    assert.match(lastQuery!.sql, /LIMIT \$1/);
    assert.deepEqual(lastQuery!.params, [5]);
  });
});
