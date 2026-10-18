// Real BEHAVIOR test for fetchBenzingaStructuredEarnings's pagination — mocking polygonTrackedFetch
// per node:test's --experimental-test-module-mocks so the actual pagination loop runs for real,
// not just a regex check against the source.
//
// BUG FIX (2026-10-18, Ask Largo standing mandate, live repro RBLX/SOFI): the loop used to follow
// a HARDCODED "up to two more pages" regardless of how dense the requested date window actually
// is. A single real earnings week already produced enough rows to exhaust the old 3-page (360-row)
// total budget before the date-ascending-sorted fetch ever reached later dates in the window —
// silently truncating real, near-term earnings prints for live committed Swing positions out of
// the market-wide window Meridian's timeline / Largo's get_meridian_timeline tool / Swing's
// "Meridian catalysts" section all read. Fixed by widening the cap to a generous, still-bounded
// MAX_EXTRA_PAGES rather than removing bounding entirely (an adversarial/malformed next_url chain
// must not hang a request forever).
import { test, mock, describe, before } from "node:test";
import assert from "node:assert/strict";

// polygonGet() throws "POLYGON_API_KEY not set" (via polygonConfigured(), which reads
// process.env live) BEFORE ever calling polygonTrackedFetch — mocking the fetch alone isn't
// enough in CI, which has no live Polygon secret (this passed in a local sandbox where
// POLYGON_API_KEY happens to be set, and failed in CI with 0 rows instead of 7/21). Same
// established pattern as polygon-short-interest-cancellation.test.ts /
// polygon-largo-cancellation.test.ts.
process.env.POLYGON_API_KEY = "test-polygon-key";

// Relative specifier, not the "@/..." alias — tsx's alias rewrite only applies to statically-
// parsed top-level `import ... from` statements, not to mock.module()'s specifier string.
let requestedUrls: string[] = [];
const TOTAL_PAGES_AVAILABLE = { count: 6 }; // mutated per-test before each fetchBenzingaStructuredEarnings call

mock.module("./polygon-rate-limiter", {
  namedExports: {
    polygonTrackedFetch: async (_endpointKey: string, url: string) => {
      requestedUrls.push(url);
      // Parsed via regex, not `new URL()` — this sandbox's POLYGON_API_BASE can be a literal,
      // non-absolute placeholder string (see CLAUDE.md's own note on this), which `new URL()`
      // rejects outright. A plain substring match is robust to that and is all this fake needs.
      const match = /[?&]page=(\d+)/.exec(url);
      const page = match ? Number(match[1]) : 0;
      const isLast = page >= TOTAL_PAGES_AVAILABLE.count - 1;
      const body = {
        results: [{ ticker: `PAGE${page}`, date: "2026-11-01", benzinga_id: `id-${page}` }],
        next_url: isLast ? undefined : `/benzinga/v1/earnings?page=${page + 1}`,
      };
      return {
        status: 200,
        ok: true,
        json: async () => body,
      } as Response;
    },
  },
});

describe("fetchBenzingaStructuredEarnings pagination", () => {
  let fetchBenzingaStructuredEarnings: typeof import("./polygon").fetchBenzingaStructuredEarnings;

  before(async () => {
    ({ fetchBenzingaStructuredEarnings } = await import("./polygon"));
  });

  test("follows MORE than 2 extra pages when a busy window has more available (the live RBLX/SOFI repro shape)", async () => {
    requestedUrls = [];
    TOTAL_PAGES_AVAILABLE.count = 7; // pages 0..6 — 7 total fetches (initial + 6 more)
    const res = await fetchBenzingaStructuredEarnings({
      dateGte: "2026-11-01",
      dateLte: "2026-11-21",
      limit: 120,
      sort: "date.asc",
      paginate: true,
    });
    assert.equal(res.rows.length, 7, "all 7 pages' rows must be present, not capped at the old 3-page/360-row budget");
    assert.equal(res.nextUrl, null, "fully-paginated result reports no further pages");
  });

  test("still bounded — stops at the safety cap rather than following an unbounded/adversarial next_url chain forever", async (t) => {
    requestedUrls = [];
    TOTAL_PAGES_AVAILABLE.count = 50; // far more pages available than any real earnings window needs
    const warnCalls: unknown[][] = [];
    const warnMock = t.mock.method(console, "warn", (...args: unknown[]) => {
      warnCalls.push(args);
    });
    try {
      const res = await fetchBenzingaStructuredEarnings({
        dateGte: "2026-11-01",
        dateLte: "2026-11-21",
        limit: 120,
        sort: "date.asc",
        paginate: true,
      });
      // 1 initial page + MAX_EXTRA_PAGES(20) = 21 total fetches/rows, never the full 50 available.
      assert.equal(res.rows.length, 21, "pagination must stop at the safety cap, not run away");
      assert.ok(warnCalls.length >= 1, "hitting the safety cap with more pages remaining must be logged, never silent");
    } finally {
      warnMock.mock.restore();
    }
  });
});
