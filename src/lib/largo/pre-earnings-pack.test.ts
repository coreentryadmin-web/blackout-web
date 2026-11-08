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

// Mutable per-test board fixture — mirrors the real `ZeroDteBoardPayload` shape just enough to
// exercise boardExposure()'s ledger/setups search + upstream_ok check. Defaults to the
// "getZeroDteBoardPayload() itself couldn't even be read" leg (null) that the pre-existing tests
// above rely on; `board_error`-focused tests below override it per-case.
type FakeBoard = {
  upstream_ok: boolean;
  ledger: Array<{
    ticker: string;
    status?: string | null;
    direction?: string | null;
    live_pnl_pct?: number | null;
    plan_pnl_pct?: number | null;
  }>;
  setups: Array<{
    ticker: string;
    direction: string;
    score: number;
    gate?: { verdict?: string } | null;
  }>;
};
let fakeBoard: FakeBoard | null = null;

mock.module("../platform/zerodte-service", {
  namedExports: {
    getZeroDteBoardPayload: async () => fakeBoard,
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

// --- boardExposure() / card.zerodte: "WHICH EMPTY IS THIS?" (2026-11-08) ---
//
// getZeroDteBoardPayload() never throws — on an outage it resolves to a structurally valid
// but degraded board (buildMinimalBoardFallback() in zerodte-service.ts: upstream_ok:false,
// empty ledger/setups). Before this fix, boardExposure() only ever searched board.ledger/
// board.setups for the ticker and never read board.upstream_ok, so a degraded board and a
// genuinely-clean "not committed, not a setup candidate" board rendered byte-identically.
// Reset benzinga/earnings fixtures to the clean-absence shape every test below so only the
// zerodte leg is under test.
function resetNonBoardFixtures(): void {
  benzingaTickerOutcome = { rows: [], entitled: true, error: null };
  nextEarningsOutcome = null;
  parsedNextOutcome = null;
}

test("boardExposure: healthy board, ticker genuinely absent — confident on_board:false, board_error null (no regression)", async () => {
  resetNonBoardFixtures();
  fakeBoard = { upstream_ok: true, ledger: [], setups: [] };
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.ok(card?.zerodte, "expected a zerodte exposure object, not null, once the board resolved");
  assert.equal(card?.zerodte?.on_board, false);
  assert.equal(card?.zerodte?.status, null);
  assert.equal(card?.zerodte?.headline, null);
  assert.equal(
    card?.zerodte?.board_error,
    null,
    "a genuinely clean, healthy absence must not report a board error"
  );
});

// RED→GREEN pin: pre-fix, boardExposure() never reads board.upstream_ok at all, so this
// degraded fallback (empty ledger/setups, upstream_ok:false) reports the exact same
// {on_board:false, status:null, board_error:undefined} shape as the healthy-absence test
// above — a confidently-wrong "Not committed" with no disclosure that the board itself
// could not be checked this build.
test("boardExposure: degraded board (upstream_ok:false) reports board_error instead of a confident on_board:false", async () => {
  resetNonBoardFixtures();
  fakeBoard = { upstream_ok: false, ledger: [], setups: [] };
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.ok(card?.zerodte, "expected a zerodte exposure object even on a degraded board");
  assert.ok(
    card?.zerodte?.board_error,
    "a degraded (upstream_ok:false) board must disclose that it could not be checked"
  );
  assert.equal(
    card?.zerodte?.on_board,
    false,
    "on_board stays false — this field alone must never be read as a confident finding once board_error is set"
  );
});

test("boardExposure: ticker found on the committed ledger of a degraded board still reports the real find (no regression)", async () => {
  resetNonBoardFixtures();
  // Even on a build where upstream_ok went false, a real match in the arrays IS real signal —
  // the fix only changes what happens on a MISS, never suppresses a genuine hit.
  fakeBoard = {
    upstream_ok: false,
    ledger: [{ ticker: "CAVA", status: "OPEN", direction: "long", live_pnl_pct: 12.5 }],
    setups: [],
  };
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.equal(card?.zerodte?.on_board, true);
  assert.equal(card?.zerodte?.status, "OPEN");
  assert.equal(card?.zerodte?.pnl_pct, 12.5);
  assert.equal(card?.zerodte?.board_error, null, "a real ledger hit is not a board error");
});

test("boardExposure: ticker found as a setup candidate on a healthy board still reports the real find (no regression)", async () => {
  resetNonBoardFixtures();
  fakeBoard = {
    upstream_ok: true,
    ledger: [],
    setups: [{ ticker: "CAVA", direction: "short", score: 71, gate: { verdict: "CLEAR" } }],
  };
  const { preEarningsPackForLargo } = await mod();
  const card = await preEarningsPackForLargo("CAVA");
  assert.equal(card?.zerodte?.on_board, false);
  assert.equal(card?.zerodte?.status, "WATCH");
  assert.equal(card?.zerodte?.direction, "short");
  assert.equal(card?.zerodte?.board_error, null);
});
