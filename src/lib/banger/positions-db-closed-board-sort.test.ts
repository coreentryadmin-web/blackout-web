import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// FIX (Ask Largo standing mandate, live-verified 2026-09-23): fetchBangerClosedBoardRows's own doc
// comment says it serves "the member board's 'recently closed' section" — but the SQL sorted by
// `session_date DESC, id DESC` (entry-time recency), not `closed_at` (close-time recency). Those
// diverge hard: a position opened weeks ago and closed just now ranks at the BOTTOM of a
// session_date-ordered list, not the top, and a 60-row LIMIT then cuts it off entirely.
//
// Caught live: PR #5468 (this same session) fixed 41 banger_positions rows stuck OPEN/PARTIAL with
// an already-expired contract, oldest 40 days past expiry (id 99, session_date 2026-07-xx). Once
// deployed and the live-sync cron ran a fresh RTH tick, fetchBangerOpenCount() confirmed 45 rows
// genuinely transitioned out of OPEN/PARTIAL (168 -> 123) — a real DB write, not a display glitch.
// But none of them appeared anywhere in GET /api/market/banger/board's `closed` array (60-row
// window): every visible row had session_date 2026-09-15..2026-09-21 (this week's entries), while
// the freshly-closed old positions (session_date back to July/August) were sorted to the very
// bottom and evicted by the LIMIT — invisible no matter how recently they actually closed.
//
// This test proves the SQL sorts by closed_at, mock.module() resolves relative to THIS file.

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

describe("fetchBangerClosedBoardRows sort order", () => {
  let fetchBangerClosedBoardRows: (limit?: number) => Promise<unknown[]>;

  before(async () => {
    ({ fetchBangerClosedBoardRows } = await import("./positions-db.ts"));
  });

  test("sorts by closed_at DESC (close-time recency), not session_date (entry-time recency)", async () => {
    lastQuery = null;
    await fetchBangerClosedBoardRows(60);
    assert.ok(lastQuery, "dbQuery must have been called");
    assert.match(lastQuery!.sql, /ORDER BY\s+closed_at\s+DESC/i);
    assert.doesNotMatch(
      lastQuery!.sql,
      /ORDER BY\s+session_date\s+DESC/i,
      "must not sort by entry-time recency — that hides freshly-closed old positions behind a LIMIT",
    );
  });

  test("still respects the limit argument", async () => {
    lastQuery = null;
    await fetchBangerClosedBoardRows(5);
    assert.ok(lastQuery, "dbQuery must have been called");
    assert.match(lastQuery!.sql, /LIMIT \$1/);
    assert.deepEqual(lastQuery!.params, [5]);
  });
});
