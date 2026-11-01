import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { OptionSnapshot } from "../providers/options-snapshot.ts";

function snap(overrides: Partial<OptionSnapshot>): OptionSnapshot {
  return {
    ticker: "O:TEST260814C00010000",
    mark: null,
    bid: null,
    ask: null,
    last: null,
    dayClose: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    openInterest: null,
    bidSize: null,
    askSize: null,
    dayVolume: null,
    underlyingPrice: null,
    strike: null,
    optionType: null,
    expiry: null,
    sharesPerContract: null,
    ...overrides,
  } as OptionSnapshot;
}

let lastQuery: { sql: string; params: unknown[] } | null = null;
let shouldReject = false;

// mock.module MUST be registered before quote-tick-log.ts (or anything importing "@/lib/db") is ever
// loaded -- a static top-level import of the module under test would resolve/cache the REAL db.ts
// first and this mock would arrive too late (the exact trap positions-db-closed-export.test.ts's own
// comment warns about). So both functions under test are imported dynamically inside `before()`,
// after this mock is registered, never via a static import at the top of this file.
mock.module("../db.ts", {
  namedExports: {
    dbQuery: async (sql: string, params: unknown[] = []) => {
      lastQuery = { sql, params };
      if (shouldReject) throw new Error("simulated DB failure");
      return { rows: queuedRows };
    },
    isoTimestampString: (v: unknown) => (v == null ? null : new Date(v as string).toISOString()),
  },
});

let queuedRows: Record<string, unknown>[] = [];

describe("banger quote-tick-log", () => {
  let buildBangerQuoteTickRow: typeof import("./quote-tick-log.ts").buildBangerQuoteTickRow;
  let persistBangerQuoteTick: typeof import("./quote-tick-log.ts").persistBangerQuoteTick;
  let fetchBangerQuoteTicksForContract: typeof import("./quote-tick-log.ts").fetchBangerQuoteTicksForContract;
  let fetchBangerQuoteTickCoverage: typeof import("./quote-tick-log.ts").fetchBangerQuoteTickCoverage;

  before(async () => {
    ({
      buildBangerQuoteTickRow,
      persistBangerQuoteTick,
      fetchBangerQuoteTicksForContract,
      fetchBangerQuoteTickCoverage,
    } = await import("./quote-tick-log.ts"));
  });

  describe("buildBangerQuoteTickRow", () => {
    const polledAt = new Date("2026-08-05T19:59:26.821Z");

    test("a normal two-sided quote resolves raw_mark and reliable_mark to the same midOf(bid,ask)", () => {
      const row = buildBangerQuoteTickRow("O:TEST260814C00010000", snap({ bid: 2.25, ask: 4.3 }), polledAt);
      assert.equal(row.contract_occ, "O:TEST260814C00010000");
      assert.equal(row.polled_at, polledAt.toISOString());
      assert.equal(row.bid, 2.25);
      assert.equal(row.ask, 4.3);
      assert.equal(row.raw_mark, 3.275);
      assert.equal(row.reliable_mark, 3.275);
    });

    test("the REAL PR #4969 shape -- bid=0/wide-ask backstop mid is REJECTED in favor of the trade reference", () => {
      const row = buildBangerQuoteTickRow("O:CRSR260918C00015000", snap({ bid: 0, ask: 15, last: 0.07 }), polledAt);
      assert.equal(row.raw_mark, 7.5); // midOf(0,15)
      assert.equal(row.reliable_mark, 0.07); // guard falls through to the real last-trade reference
    });

    test("no usable price at all -> both marks null, never fabricated", () => {
      const row = buildBangerQuoteTickRow("O:TEST260814C00010000", snap({}), polledAt);
      assert.equal(row.raw_mark, null);
      assert.equal(row.reliable_mark, null);
    });

    test("falls back to last trade when no valid two-sided quote exists", () => {
      const row = buildBangerQuoteTickRow("O:TEST260814C00010000", snap({ bid: null, ask: null, last: 1.23 }), polledAt);
      assert.equal(row.raw_mark, 1.23);
      assert.equal(row.reliable_mark, 1.23);
    });
  });

  describe("persistBangerQuoteTick", () => {
    test("inserts every field as a positional param, in order", async () => {
      lastQuery = null;
      shouldReject = false;
      const row = buildBangerQuoteTickRow("O:TEST260814C00010000", snap({ bid: 1, ask: 2 }), new Date("2026-08-05T00:00:00.000Z"));
      await persistBangerQuoteTick(row);
      assert.ok(lastQuery);
      assert.match(lastQuery!.sql, /INSERT INTO banger_quote_tick_log/);
      assert.deepEqual(lastQuery!.params, [row.contract_occ, row.polled_at, row.bid, row.ask, row.last_trade, row.raw_mark, row.reliable_mark]);
    });

    test("propagates a DB failure to the caller -- this module deliberately does NOT swallow its own errors (the call site's fire-and-forget .catch() owns that)", async () => {
      shouldReject = true;
      const row = buildBangerQuoteTickRow("O:TEST260814C00010000", snap({ bid: 1, ask: 2 }), new Date());
      await assert.rejects(() => persistBangerQuoteTick(row), /simulated DB failure/);
      shouldReject = false;
    });
  });

  describe("fetchBangerQuoteTicksForContract", () => {
    test("queries by occ + time window, ordered oldest-first, and maps rows including the DB id", async () => {
      lastQuery = null;
      shouldReject = false;
      queuedRows = [
        { id: 7, contract_occ: "O:TEST260814C00010000", polled_at: "2026-08-05T14:00:00.000Z", bid: 1, ask: 2, last_trade: 1.4, raw_mark: 1.5, reliable_mark: 1.5 },
        { id: 8, contract_occ: "O:TEST260814C00010000", polled_at: "2026-08-05T14:05:00.000Z", bid: "1.1", ask: "2.1", last_trade: null, raw_mark: "1.6", reliable_mark: "1.6" },
      ];
      const rows = await fetchBangerQuoteTicksForContract("O:TEST260814C00010000", "2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z", 100);
      assert.match(lastQuery!.sql, /FROM banger_quote_tick_log/);
      assert.match(lastQuery!.sql, /ORDER BY polled_at ASC, id ASC/);
      assert.deepEqual(lastQuery!.params, ["O:TEST260814C00010000", "2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z", 100]);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.id, 7);
      // NUMERIC columns arrive from pg as strings -- must be coerced to numbers, not passed through.
      assert.equal(rows[1]!.bid, 1.1);
      assert.equal(typeof rows[1]!.bid, "number");
    });

    test("a null reliable_mark (never a usable tick) is preserved as null, never coerced to 0 or fabricated", async () => {
      queuedRows = [
        { id: 1, contract_occ: "O:X", polled_at: "2026-08-05T14:00:00.000Z", bid: null, ask: null, last_trade: null, raw_mark: null, reliable_mark: null },
      ];
      const rows = await fetchBangerQuoteTicksForContract("O:X", "2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
      assert.equal(rows[0]!.reliable_mark, null);
    });
  });

  describe("fetchBangerQuoteTickCoverage", () => {
    test("groups by contract, returning tick_count/first_tick_at/last_tick_at per contract", async () => {
      lastQuery = null;
      queuedRows = [
        { contract_occ: "O:AAA", tick_count: 42, first_tick_at: "2026-09-27T13:30:00.000Z", last_tick_at: "2026-09-27T19:55:00.000Z" },
        { contract_occ: "O:BBB", tick_count: "3", first_tick_at: "2026-09-27T14:00:00.000Z", last_tick_at: "2026-09-27T14:10:00.000Z" },
      ];
      const rows = await fetchBangerQuoteTickCoverage("2026-09-20T00:00:00.000Z", 500);
      assert.match(lastQuery!.sql, /GROUP BY contract_occ/);
      assert.deepEqual(lastQuery!.params, ["2026-09-20T00:00:00.000Z", 500]);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.tick_count, 42);
      assert.equal(rows[1]!.tick_count, 3);
      assert.equal(typeof rows[1]!.tick_count, "number");
    });
  });
});
