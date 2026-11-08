import assert from "node:assert/strict";
import { test, mock } from "node:test";

// pre-earnings-pack.ts pulls in a real `import "server-only"`, which throws under plain Node
// outside a Next.js server bundle — same stub every sibling test in this repo uses.
mock.module("server-only", { namedExports: {} });

// Every mock.module() specifier below is RELATIVE, mirroring the production file's own
// directory (src/lib/largo/) — not the "@/..." alias pre-earnings-pack.ts uses for its static
// top-level imports. tsx rewrites path aliases for a statically-parsed top-level import, but
// NOT for mock.module()'s own specifier string, and NOT for a dynamic import() call either —
// see pre-earnings-pack.ts's own in-code comment (and ecosystem-context.test.ts's identical
// note) for why its two Promise.all-wrapped dynamic imports were switched to relative
// specifiers specifically so this file could intercept them.

mock.module("../providers/spx-session", {
  namedExports: {
    todayEtYmd: () => "2026-11-08",
  },
});

mock.module("./temporal/bar-session-date", {
  namedExports: {
    etStamp: () => "2026-11-08 09:00 ET",
  },
});

mock.module("./temporal/session-calendar", {
  namedExports: {
    weekdayEt: () => "Sunday",
  },
});

mock.module("../meridian/meridian-earnings-history", {
  namedExports: {
    loadMeridianEarningsPrintHistory: async () => ({
      print_history: [],
      print_history_summary: null,
      history_error: null,
    }),
  },
});

mock.module("../meridian/meridian-earnings-expected-move", {
  namedExports: {
    loadEarningsExpectedMovePct: async () => null,
  },
});

type BenzingaTickerOutcome = { rows: unknown[]; entitled: boolean; error: string | null };
type NextEarningsOutcome = {
  ticker: string;
  earnings_date: string | null;
  days_until: number | null;
  report_time: string | null;
  is_confirmed: boolean | null;
  error?: string | null;
} | null;
type ParsedNextOutcome = NextEarningsOutcome;

let benzingaTickerOutcome: BenzingaTickerOutcome = { rows: [], entitled: true, error: null };
let nextEarningsOutcome: NextEarningsOutcome = null;
let parsedNextOutcome: ParsedNextOutcome = null;

mock.module("../meridian/meridian-benzinga-earnings", {
  namedExports: {
    loadBenzingaTickerEarnings: async () => benzingaTickerOutcome,
    loadNextEarningsFromBenzinga: async () => nextEarningsOutcome,
  },
});

mock.module("../meridian/meridian-benzinga-earnings-core", {
  namedExports: {
    parseNextEarningsFromBenzinga: () => parsedNextOutcome,
  },
});

mock.module("./pre-earnings-history-rows", {
  namedExports: {
    toPreEarningsHistoryRows: () => [],
    earningsAlreadyPrinted: () => false,
  },
});

// The three dynamic imports inside preEarningsPackForLargo/boardExposure — mocked null/empty
// since this file is only exercising the earnings_error leg, not positioning/flow/board.
mock.module("../providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => null,
  },
});

mock.module("../platform", {
  namedExports: {
    marketPlatform: {
      flows: {
        getFlowTapeSummary: async () => null,
      },
    },
  },
});

mock.module("../platform/zerodte-service", {
  namedExports: {
    getZeroDteBoardPayload: async () => null,
  },
});

const mod = () => import("./pre-earnings-pack");

test("preEarningsPackForLargo: a genuinely clean read (no rows, no error) has earnings_error null — no regression", async () => {
  benzingaTickerOutcome = { rows: [], entitled: true, error: null };
  nextEarningsOutcome = null;
  parsedNextOutcome = null;
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.ok(card, "expected a card for a valid ticker");
  assert.equal(card?.earnings_error, null, "a genuine clean absence must not report a fetch error");
  assert.equal(card?.earnings_date, null);
});

// RED→GREEN pin: pre-fix, `earnings_error` does not exist on the returned object at all
// (undefined), so this assertion fails. Mirrors the live Benzinga entitlement 403 (CLAUDE.md's
// "ENTITLEMENT REGRESSED 2026-11-07" note) via the exact same shapes
// meridian-benzinga-earnings.test.ts already pins for loadNextEarningsFromBenzinga itself.
test("preEarningsPackForLargo: a FAILED calendar fetch carries the real error instead of a bare null leg", async () => {
  benzingaTickerOutcome = { rows: [], entitled: false, error: "not_entitled" };
  nextEarningsOutcome = {
    ticker: "CAVA",
    earnings_date: null,
    days_until: null,
    report_time: null,
    is_confirmed: null,
    error: "benzinga_ticker_earnings:not_entitled",
  };
  parsedNextOutcome = null;
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.ok(card, "expected a card even on a failed fetch — the pack itself must not throw");
  assert.ok(
    card?.earnings_error,
    "a failed calendar fetch must not collapse earnings_error to null/undefined"
  );
  assert.match(
    card?.earnings_error ?? "",
    /not_entitled/,
    `expected the real failure to be carried through, got: ${card?.earnings_error}`
  );
  assert.equal(card?.earnings_date, null, "still no real date to show — the read failed");
  assert.equal(card?.days_until, null);
  assert.equal(card?.report_time, null);
  assert.equal(card?.is_confirmed, null);
});

test("preEarningsPackForLargo: a real resolved earnings date reports earnings_error null — no regression", async () => {
  benzingaTickerOutcome = {
    rows: [
      {
        ticker: "CAVA",
        date: "2026-12-10",
        time: "16:05:00",
        date_status: "confirmed",
        actual_eps: null,
        actual_revenue: null,
      },
    ],
    entitled: true,
    error: null,
  };
  nextEarningsOutcome = null;
  parsedNextOutcome = {
    ticker: "CAVA",
    earnings_date: "2026-12-10",
    days_until: 32,
    report_time: "afterhours",
    is_confirmed: true,
  };
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.ok(card);
  assert.equal(card?.earnings_error, null, "a real resolved date must not carry a spurious error");
  assert.equal(card?.earnings_date, "2026-12-10");
  assert.equal(card?.days_until, 32);
  assert.equal(card?.report_time, "afterhours");
  assert.equal(card?.is_confirmed, true);
});
