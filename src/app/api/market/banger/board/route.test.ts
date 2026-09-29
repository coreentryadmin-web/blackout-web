import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// BUG (found live 2026-09-16, Ask Largo standing mandate): this route used to fetch ONE combined
// `fetchBangerBoardRows(60)` page (top 60 rows of ALL statuses, filtered into open/closed in JS
// after), so once total (open+closed) rows exceeded 60, older-but-still-OPEN positions aged out of
// the shared window and silently vanished from the member-facing board while still being real, live
// holdings. Confirmed live: this route reported exactly open:33/closed:27/total:60 (the limit fully
// saturated) while the swing play-brief's portfolio-overlap check (which queries open rows directly,
// filtered at the SQL level before any limit) correctly saw an older OPEN CRWD position this route's
// `open` array was dropping. Fixed by querying open and closed as two SEPARATELY limited reads, so a
// growing closed backlog can never crowd a real open position out of the board.
//
// mock.module() resolves relative to THIS file (nighthawk/horizons route-test pattern).

function bangerRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    ticker: "T",
    session_date: "2026-09-15",
    contract_strike: 1,
    contract_expiry: "2026-09-25",
    contract_occ: "occ",
    entry_premium: 1,
    last_mark: null,
    peak_premium: null,
    status: "OPEN",
    scaled_already: false,
    scale_out_action: null,
    scale_out_reason: null,
    realized_pnl_pct: null,
    realized_pnl_usd: null,
    discovery_gain: null,
    discovery_vol: null,
    discovery_dollar_vol: null,
    discovery_close_strength: null,
    committed_at: "2026-09-15T16:00:00.000Z",
    closed_at: null,
    ...overrides,
  };
}

// 70 OPEN rows + 27 CLOSED rows = 97 total, well past the old shared 60-row cap — the exact shape
// (total > 60, open alone > 60) that reproduces the bug: with the old combined top-60 query, only
// the newest 60 of these 97 rows would even be considered before the open/closed split, so at most
// 60 (and likely fewer, once closed rows crowd the window) of the 70 real OPEN rows would ever
// reach the response.
const OPEN_ROWS = Array.from({ length: 70 }, (_, i) => bangerRow({ id: 1000 + i, ticker: `OPEN${i}`, status: "OPEN" }));
const CLOSED_ROWS = Array.from({ length: 27 }, (_, i) =>
  bangerRow({ id: 2000 + i, ticker: `CLOSED${i}`, status: "STOPPED", closed_at: "2026-09-15T20:00:00.000Z" }),
);

mock.module("server-only", { namedExports: {} });
mock.module("../../../../../lib/banger/flag", {
  namedExports: { isBangerEngineEnabled: () => true },
});
mock.module("../../../../../lib/banger/positions-db", {
  namedExports: {
    fetchBangerOpenBookRows: async (limit: number) => OPEN_ROWS.slice(0, limit),
    fetchBangerClosedBoardRows: async (limit: number) => CLOSED_ROWS.slice(0, limit),
  },
});
mock.module("../../../../../lib/zerodte/scale-out", {
  namedExports: { bangerScaleOutNote: () => "note" },
});
mock.module("../../../../../lib/db", {
  namedExports: { requireDatabaseInProduction: () => null },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});

describe("/api/market/banger/board open/closed are independently paged", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("all real OPEN positions survive even when open+closed together exceed the old shared 60-row cap", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/banger/board"));
    const body = await res.json();
    assert.equal(body.open.length, 70, "every OPEN row must reach the board, not just the newest 60-total slice");
    assert.equal(body.closed.length, 27);
  });

  test("open rows are never STOPPED/CLOSED_RUNNER and closed rows are never OPEN/PARTIAL", async () => {
    const res = await GET(new NextRequest("http://localhost/api/market/banger/board"));
    const body = await res.json();
    for (const row of body.open) assert.equal(row.status, "OPEN");
    for (const row of body.closed) assert.equal(row.status, "STOPPED");
  });
});
