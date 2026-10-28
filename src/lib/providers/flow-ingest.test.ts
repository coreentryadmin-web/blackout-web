import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

// Regression (docs/audit/FINDINGS.md, flow-ingest UW pagination truncation): UW's
// /api/option-trades/flow-alerts returns rows NEWEST-FIRST, and a `newer_than` filter does not
// change that — it's still capped at `limit`, counting down from "now". Confirmed live: fetching
// with `newer_than` set a couple hours back and `limit=200` returned only the newest ~55 minutes
// of that window, silently dropping everything older in the gap. A single fixed `limit: 100` fetch
// (the pre-fix shape of `runFlowIngest`) has exactly this blind spot whenever more than one page's
// worth of alerts landed since the cursor — realistically, a WS outage during a volatile session,
// since REST only runs at all when the WS path is down. The fix backfills with `older_than` set to
// the oldest row of a full page, bounded by MAX_BACKFILL_PAGES, and reports `truncated: true` if
// even that bound is exceeded.
//
// mock.module() resolves bare specifiers relative to THIS file (not the "@/" tsconfig alias) —
// see src/app/api/market/gex-heatmap/route.test.ts for the same pattern.

type MockRawRow = { id: number; created_at: string };
type MockFlow = {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
  alert_rule: string | null;
  trade_count: number | null;
  has_sweep: boolean;
};
type MockRow = { raw: MockRawRow; flow: MockFlow };

function makeRow(id: number, createdAt: string): MockRow {
  return {
    raw: { id, created_at: createdAt },
    flow: {
      ticker: "SPY",
      premium: 500_000,
      option_type: "CALL",
      expiry: "2026-02-20",
      strike: 600,
      direction: "bullish",
      score: 50,
      route: "SWEEP",
      alerted_at: createdAt,
      alert_rule: null,
      trade_count: null,
      has_sweep: false,
    },
  };
}

/** Descending (newest-first) rows, 1 second apart, matching UW's real sort order. */
function makeDescendingRows(count: number, startId: number, startMs: number): MockRow[] {
  const rows: MockRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(makeRow(startId + i, new Date(startMs - i * 1000).toISOString()));
  }
  return rows;
}

let fetchCalls: Array<{ limit?: number; newer_than?: string; older_than?: string }> = [];
let fetchResponses: MockRow[][] = [];
let persistCalls = 0;
let metaStore: Record<string, string> = {};

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    getMeta: async (key: string) => metaStore[key] ?? null,
    setMeta: async (key: string, value: string) => {
      metaStore[key] = value;
    },
    tryAdvisoryLock: async () => true,
    releaseAdvisoryLock: async () => {},
  },
});
mock.module("../flow-persist", {
  namedExports: {
    MIN_PREMIUM_FETCH_FLOOR: 50_000,
    persistAndPublishFlowAlert: async () => {
      persistCalls += 1;
      return { inserted: true };
    },
  },
});
mock.module("./unusual-whales", {
  namedExports: {
    fetchMarketFlowAlertRows: async (params: { limit?: number; newer_than?: string; older_than?: string }) => {
      fetchCalls.push(params);
      return fetchResponses[fetchCalls.length - 1] ?? [];
    },
  },
});
mock.module("./config", {
  namedExports: { uwConfigured: () => true },
});
mock.module("../ws/uw-socket", {
  namedExports: {
    uwSocket: { getStatus: () => ({ flow_alerts: "CLOSED" }) },
    isUwChannelFresh: () => false,
  },
});
mock.module("../flow-liveness", {
  namedExports: { isFlowFrameFreshFromCluster: async () => false },
});
mock.module("../cron-writer-target-fresh", {
  namedExports: {
    probePgFlowAlertsFresh: async () => ({ fresh: false, ageMin: null }),
  },
});

let runFlowIngest: typeof import("./flow-ingest").runFlowIngest;

before(async () => {
  ({ runFlowIngest } = await import("./flow-ingest"));
});

describe("runFlowIngest UW pagination backfill", () => {
  test("a short first page ingests normally with no backfill call", async () => {
    fetchCalls = [];
    fetchResponses = [makeDescendingRows(5, 1, Date.parse("2026-01-01T00:05:00Z"))];
    persistCalls = 0;
    metaStore = {};

    const result = await runFlowIngest();

    assert.equal(fetchCalls.length, 1, "a short (non-full) page must not trigger a backfill fetch");
    assert.equal(result.ingested, 5);
    assert.equal(result.polled, 5);
    assert.equal(result.truncated, false);
  });

  test("a full first page backfills with older_than instead of silently dropping the gap", async () => {
    fetchCalls = [];
    persistCalls = 0;
    metaStore = {};

    // Page 1: 100 rows (a FULL page), newest at :05:00, 1s apart down to :03:21.
    const page1 = makeDescendingRows(100, 1000, Date.parse("2026-01-01T00:05:00Z"));
    const boundary = page1[page1.length - 1].raw.created_at; // oldest row in page 1
    // Page 2: 30 rows, starting at the SAME inclusive boundary timestamp (UW's older_than is
    // inclusive — confirmed live), then strictly older. Only 29 are genuinely new.
    const page2 = [
      makeRow(1099, boundary), // overlaps page 1's last row's timestamp — must be deduped
      ...makeDescendingRows(29, 1100, Date.parse(boundary) - 1000),
    ];
    fetchResponses = [page1, page2];

    const result = await runFlowIngest();

    assert.equal(fetchCalls.length, 2, "a full page must trigger exactly one backfill fetch here");
    assert.equal(fetchCalls[0].older_than, undefined, "the first page must not be bounded by older_than");
    assert.equal(fetchCalls[1].older_than, boundary, "the backfill page must query older_than the first page's oldest row");
    assert.equal(result.polled, 130, "both pages (100 + 30) were fetched");
    assert.equal(result.ingested, 129, "the boundary-overlap row is deduped, not double-persisted");
    assert.equal(persistCalls, 129, "persist is called once per unique row, not once per fetched row");
    assert.equal(result.truncated, false, "the gap was fully backfilled inside the page cap");
  });

  test("a backlog deeper than the backfill cap reports truncated instead of looping forever", async () => {
    fetchCalls = [];
    persistCalls = 0;
    metaStore = {};

    // 5 full, non-overlapping pages of 100 rows each — exactly the MAX_BACKFILL_PAGES cap.
    const pages: MockRow[][] = [];
    for (let p = 0; p < 5; p++) {
      pages.push(makeDescendingRows(100, 1 + p * 100, Date.parse("2026-01-01T00:05:00Z") - p * 100_000));
    }
    fetchResponses = pages;

    const result = await runFlowIngest();

    assert.equal(fetchCalls.length, 5, "must stop at the MAX_BACKFILL_PAGES bound, not loop forever");
    assert.equal(result.polled, 500);
    assert.equal(result.truncated, true, "exhausting the page cap on a still-full page must report truncated");
  });
});
