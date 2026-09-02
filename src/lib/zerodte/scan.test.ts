import { test, mock } from "node:test";
import assert from "node:assert/strict";

// scan.ts pulls in the FULL 0DTE provider graph (Night Hawk dossier builder, Polygon
// bar/quote providers, the options WS socket, server-cache) to run the live scan
// pipeline — irrelevant to what this file actually tests (zeroDtePlaysFeed's ledger-
// read + live-sync path). Every provider-touching import scan.ts pulls in gets a
// hermetic stand-in below, the same wholesale-mock idiom rejections.test.ts and
// largo-terminal.test.ts already use for this exact module graph (largo-terminal.test.ts
// mocks "./zerodte/scan" wholesale for the same reason, one level up). ./board,
// ./intraday, ./plan, ./rejections, and nighthawk/constants are left REAL — they're
// provider-import-free pure modules by their own module docs, so importing them for
// real here is both safe and a better test (derivePlayStatus's actual logic runs).
//
// P1 regression guard (found during the 0DTE Command entry-gate audit — see
// FINDINGS.md "0DTE Command's ambient Largo feed used a stale parallel scan path"):
// zeroDtePlaysFeed() used to read readZeroDteLedger() RAW with no live-quote sync,
// trusting the ~2-min grid-warm cron's last write. This proves it now calls the same
// syncLedgerLiveState() the canonical board payload (zerodte-service.ts) uses, so a
// play that has since stopped out no longer shows as "OPEN" in Largo's context.

type LedgerRow = Record<string, unknown>;

const state = {
  ledgerRows: [] as LedgerRow[],
  /** Flow prints fetchRecentFlows returns — drives the deriveZeroDteSetups discovery
   *  path in the scanZeroDteBoard governor-wiring test below. */
  flows: [] as Array<Record<string, unknown>>,
  /** When true, fetchZeroDteSetupLog throws — drives the P0 ledger-read-failure tests. */
  ledgerReadFails: false,
  liveMark: null as number | null,
  updateCalls: [] as Array<{ session_date: string; ticker: string; patch: unknown }>,
  // gradeZeroDteLedger wiring (index-root mapping test below)
  ungradedRows: [] as LedgerRow[],
  gradeCalls: [] as Array<{ sessionDate: string; ticker: string; grade: Record<string, unknown> }>,
  aggBarCalls: [] as Array<{ symbol: string; timespan: string }>,
  dailyBars: new Map<string, Array<{ t: number; o: number; h: number; l: number; c: number }>>(),
  // persistZeroDteScan wiring (PR-F commit-time tier stamp test below)
  upsertRows: [] as Array<Record<string, unknown>>,
  // WS-01 atomic-commit wiring. `atomicLedger`, when set, is the IN-TRANSACTION ledger the
  // recount sees (a racing writer's committed book) — null means "recount == pre-cycle
  // snapshot" (the uncontended case). `atomicReturnsNull` forces the fallback path.
  atomicLedger: null as LedgerRow[] | null,
  atomicReturnsNull: false,
  atomicSelectedRows: [] as Array<Record<string, unknown>>,
  // Durable rejection rows the REAL persistZeroDteRejections writes (WS-01 recount drops +
  // scan-time gate blocks) — captured so a test can prove a withheld commit is fail-VISIBLE.
  rejectionRows: [] as Array<Record<string, unknown>>,
  // G-11 firewall wiring (rank-7 earnings block test below): the market-wide earnings
  // snapshot readGridEarnings returns, and the set of tickers the halt store reports.
  earningsItems: [] as Array<Record<string, unknown>>,
  haltedTickers: new Set<string>(),
  // D2 firewall wiring: the halt FEED's staleness (both UW + LULD halt sources cold). Distinct
  // from haltedTickers (an ACTIVE stored halt). isTradingHaltChannelStale() reads this.
  haltFeedStale: false,
};

function resetState() {
  state.ledgerRows = [];
  state.flows = [];
  state.ledgerReadFails = false;
  state.liveMark = null;
  state.updateCalls = [];
  state.ungradedRows = [];
  state.gradeCalls = [];
  state.aggBarCalls = [];
  state.dailyBars = new Map();
  state.upsertRows = [];
  state.atomicLedger = null;
  state.atomicReturnsNull = false;
  state.atomicSelectedRows = [];
  state.rejectionRows = [];
  state.earningsItems = [];
  state.haltedTickers = new Set();
  state.haltFeedStale = false;
}

// scan.ts's exit-engine wiring (./exit-sync) imports ./live-marks, which reaches
// @/lib/et-market-hours → @/lib/et-date → `import "server-only"` — same stub the
// platform service tests use for the same boundary.
mock.module("server-only", { namedExports: {} });

// The exit engine's thesis-break check fetches Cortex evidence for OPEN rows
// (bounded + fail-soft). Hermetic stand-in: a throwing fetch degrades to
// "evidence unavailable → thesis check skipped" — the fail-soft contract itself —
// so no real reader fan-out (or its 2.5s per-source budgets) ever runs in here.
// CORTEX_SOURCE_TIMEOUT_MS must exist too: the cortex barrel re-exports it from
// this same module, and ESM linking checks every re-exported name.
mock.module("../nighthawk/cortex/fetch", {
  namedExports: {
    fetchCortexInputs: async () => {
      throw new Error("hermetic: no cortex reads in scan.test.ts");
    },
    CORTEX_SOURCE_TIMEOUT_MS: 2_500,
  },
});

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    stampZeroDteExitContext: async () => {},
    fetchZeroDteSetupLog: async () => {
      if (state.ledgerReadFails) throw new Error("hermetic: simulated ledger read failure");
      return state.ledgerRows;
    },
    updateZeroDteLiveState: async (session_date: string, ticker: string, patch: unknown) => {
      state.updateCalls.push({ session_date, ticker, patch });
    },
    // Unused by the functions under test, but scan.ts imports these at module scope
    // from "@/lib/db" (which resolves to this same mocked file) — must exist or the
    // ESM import throws "does not provide an export named ...".
    fetchLatestNighthawkEdition: async () => null,
    fetchOpenSpxPlay: async () => null,
    fetchRecentFlows: async () => state.flows,
    fetchUngradedZeroDteRows: async () => state.ungradedRows,
    gradeZeroDteSetupRow: async (sessionDate: string, ticker: string, grade: Record<string, unknown>) => {
      state.gradeCalls.push({ sessionDate, ticker, grade });
    },
    insertAlertAuditLog: async () => {},
    updateZeroDtePlanOutcome: async () => {},
    upsertZeroDteSetupLog: async (rows: Array<Record<string, unknown>>) => {
      state.upsertRows.push(...rows);
      return new Set<string>(rows.map((r) => String(r.ticker).toUpperCase()));
    },
    // WS-01 — hermetic stand-in for the atomic transactional commit. Runs the caller's
    // recount `select` against the IN-TRANSACTION ledger (state.atomicLedger ?? the pre-cycle
    // book) exactly as the real xact-locked path does, so the recount+re-evaluate logic under
    // test runs for real; only the Postgres transaction/lock machinery is stubbed away.
    commitFreshZeroDteRowsAtomic: async (
      _sessionDate: string,
      select: (ledger: LedgerRow[]) => Array<Record<string, unknown>>
    ) => {
      if (state.atomicReturnsNull) return null; // force the fallback-to-plain-upsert path
      const ledger = state.atomicLedger ?? state.ledgerRows;
      const survivors = select(ledger);
      state.atomicSelectedRows.push(...survivors);
      state.upsertRows.push(...survivors);
      return new Set<string>(survivors.map((r) => String(r.ticker).toUpperCase()));
    },
    // rejections.ts (left REAL) writes recount/gate drops through these; capture them so a
    // test can assert the withheld commit is durably recorded (fail-VISIBLE, not silent).
    getMeta: async () => null,
    setMeta: async () => {},
    insertZeroDteScanRejection: async (row: Record<string, unknown>) => {
      state.rejectionRows.push(row);
    },
  },
});

// scan.ts's G-6 calibration context reads the Night Hawk echo through
// @/lib/bie/ecosystem-context, whose real import graph reaches @/lib/db and beyond —
// stubbed to an empty map (no takes → no conflicts), same wholesale idiom as below.
mock.module("../bie/ecosystem-context", {
  namedExports: {
    fetchNighthawkEchoForTickers: async () => new Map(),
  },
});

mock.module("../../features/nighthawk/lib/dossier", {
  namedExports: {
    createDossierBuildCache: () => ({}),
    fetchTickerDossier: async () => null,
  },
});

mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-06",
    etNowParts: () => ({ hour: 11, minute: 30 }),
    // ./exit-sync pulls ./live-marks into scan.ts's graph, which reaches
    // @/lib/et-market-hours and @/features/spx/lib/spx-play-session-guards — both
    // real modules importing these names from this (mocked) module.
    isTradingDayEt: () => true,
    formatEtDate: (d: Date) => d.toISOString().slice(0, 10),
    // G-11 earnings firewall: attachGateVerdicts matches today/nextDay to flag reporters.
    nextTradingDayEt: () => "2026-07-07",
  },
});

// G-11 firewall (rank-7 earnings block test): scan.ts dynamic-imports these two cheap
// halt/earnings readers to flag EVERY committable candidate, not just the dossier top-5.
// Hermetic stand-ins driven by `state` — no Redis, no in-memory WS store, no network.
mock.module("./earnings", {
  namedExports: {
    readGridEarnings: async () => ({ as_of: "2026-07-06T15:00:00Z", items: state.earningsItems }),
  },
});
mock.module("../ws/uw-socket", {
  namedExports: {
    shouldBlockForTradingHalt: (symbols: readonly string[]) => {
      const hit = symbols.some((s) => state.haltedTickers.has(s.toUpperCase()));
      return { block: hit, reason: hit ? "halted" : null };
    },
    // D2: the halt-feed staleness read (both UW + LULD halt sources cold). scan.ts surfaces this
    // as haltFeedStale so G-11 fails a fresh commit closed on a dead halt socket (empty store ≠
    // "no halts"). Note this mock's shouldBlockForTradingHalt ignores failClosedOnStale (returns
    // active-halt only), exactly like the real read scan.ts does with failClosedOnStale:false —
    // so the OLD scan (which never read staleness) committed here, proving the fail-before.
    isTradingHaltChannelStale: () => state.haltFeedStale,
    warmUwClusterFreshnessFromRedis: async () => {},
    // WS-21: scan.ts reads the live source-health snapshot for the (default-off) recovery gate.
    // The mock must mirror the real module's surface; a benign "HEALTHY" keeps the gate inert.
    getFlowSourceHealthState: () => "HEALTHY",
  },
});

mock.module("../providers/polygon-largo", {
  namedExports: {
    // Mirrors the real provider's failure mode this suite guards against: an
    // unknown/unmapped symbol does NOT throw — Polygon answers status OK with an
    // EMPTY result set. Only symbols seeded into state.dailyBars return bars.
    fetchAggBars: async (symbol: string, _mult: number, timespan: string) => {
      state.aggBarCalls.push({ symbol, timespan });
      return state.dailyBars.get(symbol) ?? [];
    },
  },
});

mock.module("../providers/options-snapshot", {
  namedExports: {
    // syncLedgerLiveState only reads `.mark` off each returned snapshot.
    fetchOptionsUnifiedSnapshot: async (occs: string[]) => {
      const map = new Map<string, { mark: number | null; bid: number | null; ask: number | null; underlyingPrice: number | null }>();
      for (const occ of occs) {
        if (state.liveMark != null) {
          map.set(occ, { mark: state.liveMark, bid: state.liveMark, ask: state.liveMark, underlyingPrice: null });
        }
      }
      return map;
    },
  },
});

mock.module("../ws/options-socket", {
  namedExports: {
    // Never actually invoked by zeroDtePlaysFeed/syncLedgerLiveState (they read occ
    // straight off plan_json) — stubbed only so the module-scope import resolves.
    buildOcc: () => null,
    // ./live-marks (pulled in via ./exit-sync) imports these at module scope; the
    // exit path only READS the lane's in-memory store, never the WS pool itself.
    getLiveOptionMark: async () => null,
    subscribeContracts: () => {},
    unsubscribeContracts: () => {},
  },
});

mock.module("../server-cache", {
  namedExports: {
    withServerCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    TTL: { OPTIONS_CHAIN: 30_000, NEWS: 60_000, MARKET_SNAPSHOT: 5_000 },
  },
});

// governor.ts's loadRecordedGovernorStops reads the Redis-backed shared cache for stop
// TIMESTAMPS. Hermetic no-op (no recorded stops) — the ledger-derived halt tallies are
// what the governor-wiring test exercises, and those come straight from Postgres rows.
mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async () => {},
  },
});

// scanZeroDteBoard's G-7 macro-calendar read + the fresh-ticker vector pre-warm both
// reach live providers; neither is needed to exercise the governor wiring. Stubbed so
// the discovery pass stays hermetic (no network, no 2.5s within() timeouts).
mock.module("../providers/macro-events", {
  namedExports: { macroEventsOnDateLive: async () => [] },
});
mock.module("../bie/vector-full-state", {
  namedExports: { fetchVectorFullState: async () => null },
});

// ./rejections (left real below) imports @/lib/providers/spx-session directly (for
// todayEtYmd), which transitively pulls @/lib/et-date's `import "server-only"` —
// same "server-only" pull-in problem run-tool.test.ts/rejections.test.ts document
// for their own siblings. Stubbed for the same reason.
mock.module("../providers/spx-session", {
  // entry-context.ts (session-context fetch) also pulls priorEtYmd for the SPY daily
  // window that feeds the regime read; stub it alongside todayEtYmd so the fetch runs.
  namedExports: { todayEtYmd: () => "2026-07-06", priorEtYmd: (_d?: number) => "2026-05-27" },
});

// scan.ts's last line re-exports zeroDtePlaysForLargo from zerodte-service.ts (a
// deliberate circular import: zerodte-service.ts itself imports FROM scan.ts) —
// zerodte-service.ts pulls in @/lib/bie/ecosystem-context, @/lib/providers/polygon,
// @/lib/zerodte/earnings, and @/lib/zerodte/intel, one of which transitively reaches
// a "server-only" boundary. Not needed for anything this file tests, so mocked
// wholesale to keep the import graph hermetic.
mock.module("../platform/zerodte-service", {
  namedExports: { zeroDtePlaysForLargo: async () => ({}) },
});

const mod = () => import("./scan");

function baseRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    session_date: "2026-07-06",
    ticker: "NVDA",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 140,
    // Recent relative to the REAL clock: the exit engine's flat-timeout ages a row
    // off first_flagged_at vs Date.now(), and a fixture stamped hours/days in the
    // past would read as ≥45min of flat theta bleed and (correctly) exit — these
    // tests are about the sync/grade paths, not the timeout rule (covered in
    // exit-engine.test.ts / exit-sync.test.ts).
    first_flagged_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    entry_premium: 4.2,
    last_mark: 4.2,
    status: "OPEN",
    top_strike: 145,
    conviction: null,
    gross_premium: 2_000_000,
    flow_avg_fill: 4.2,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    plan_json: { occ: "O:NVDA260706C00145000" },
    underlying_latest: null,
    flags_json: null,
    expiry: "2026-07-06",
    dossier_score: null,
    close_price: null,
    peak_premium: 4.2,
    trough_premium: 4.2,
    ...overrides,
  };
}

test("zeroDtePlaysFeed: reflects the FRESH live-synced status/mark, not the stale cron-written row", async () => {
  resetState();
  // The DB row as the ~2-min grid-warm cron last wrote it: status "OPEN", mark 4.2.
  // A live quote snapshot now shows 2.0 — the play's -50% stop (2.1) has since fired,
  // but nothing has told Postgres yet.
  state.ledgerRows = [baseRow({ last_mark: 4.2, status: "OPEN", trough_premium: 2.0 })];
  state.liveMark = 2.0;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { available: boolean; plays: Array<Record<string, unknown>> };

  assert.equal(feed.available, true);
  const play = feed.plays[0]!;
  // Pre-fix, this read the raw ledger row unsynced and would have asserted
  // status "OPEN" / last_mark 4.2 — the exact stale-parallel-path divergence.
  assert.equal(play.status, "CLOSED", "status must reflect the live-synced stop, not the stale cron write");
  assert.equal(play.last_mark, 2.0, "last_mark must be the fresh quote, not the stale DB value");
  // Proves syncLedgerLiveState actually ran (it persists the derived state back).
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0]!.ticker, "NVDA");
});

test("zeroDtePlaysFeed: a still-live play with no quote change stays exactly as flagged", async () => {
  resetState();
  state.ledgerRows = [baseRow({ status: "OPEN", last_mark: 4.2 })];
  state.liveMark = 4.2;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { plays: Array<Record<string, unknown>> };

  assert.equal(feed.plays[0]!.status, "OPEN");
  assert.equal(feed.plays[0]!.last_mark, 4.2);
});

// ── C3: absence is not emptiness ─────────────────────────────────────────────────
// These two states used to return the IDENTICAL `available: false` payload. Largo's
// system prompt treats this feed as the authoritative source for the turn, so the
// collapse meant a ledger OUTAGE was reported to a member as a quiet session.
test("zeroDtePlaysFeed: scanner ran, nothing committed — a MEASURED empty, not a failure", async () => {
  resetState();
  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as Record<string, unknown>;
  assert.equal(feed.available, true, "a quiet session is the tool WORKING, not the tool broken");
  assert.deepEqual(feed.plays, []);
  assert.equal(feed.state, "no_plays_committed");
  assert.equal(feed.degraded, undefined);
  assert.match(String(feed.note), /MEASURED/);
});

test("zeroDteFeedEmptyEnvelope: ledger unreadable — an UNKNOWN that must not read as 'no plays'", async () => {
  const { zeroDteFeedEmptyEnvelope } = await mod();
  const blind = zeroDteFeedEmptyEnvelope(false, "2026-07-06");
  assert.equal(blind.available, false);
  assert.equal(blind.degraded, true);
  assert.equal(blind.reason, "ledger_unreadable");
  assert.equal(blind.plays, undefined, "no empty plays array — that is what invited 'no plays today'");
  assert.match(String(blind.note), /NOT 'no plays today'/);
});

test("zeroDteFeedEmptyEnvelope: the two empty states never serialize alike", async () => {
  const { zeroDteFeedEmptyEnvelope } = await mod();
  const quiet = zeroDteFeedEmptyEnvelope(true, "2026-07-06");
  const blind = zeroDteFeedEmptyEnvelope(false, "2026-07-06");
  assert.notDeepEqual(quiet, blind, "a quiet session and a blind one must be distinguishable");
  assert.equal(quiet.available, true);
  assert.equal(blind.available, false);
  // Both must carry the session they describe — an undated envelope is C1's defect.
  assert.equal(quiet.session_date, "2026-07-06");
  assert.equal(blind.session_date, "2026-07-06");
});

test("zeroDtePlaysFeed: a same-session last-good latch still counts as KNOWN, not blind", async () => {
  // readZeroDteLedgerChecked keeps a last-good snapshot for today; a transient failure
  // after a good read is still a known committed set, so the feed must stay available.
  resetState();
  state.ledgerRows = [baseRow({ status: "OPEN" })];
  const { zeroDtePlaysFeed } = await mod();
  await zeroDtePlaysFeed();                 // primes the latch with a good read
  state.ledgerReadFails = true;
  const feed = (await zeroDtePlaysFeed()) as Record<string, unknown>;
  assert.equal(feed.available, true, "a latched same-session ledger is known, not unreadable");
  assert.equal(feed.reason, undefined);
});

test("zeroDtePlaysFeed: a graded CLOSED play surfaces its result string unchanged", async () => {
  resetState();
  state.ledgerRows = [
    baseRow({ status: "CLOSED", plan_outcome: "doubled", plan_pnl_pct: 100, last_mark: 8.4 }),
  ];
  // CLOSED rows are terminal — syncLedgerLiveState skips them, no live quote needed.
  state.liveMark = null;

  const { zeroDtePlaysFeed } = await mod();
  const feed = (await zeroDtePlaysFeed()) as { plays: Array<Record<string, unknown>> };

  assert.equal(feed.plays[0]!.status, "CLOSED");
  assert.equal(feed.plays[0]!.result, "doubled +100%");
  assert.equal(state.updateCalls.length, 0, "a CLOSED row must never be re-synced");
});

// ── P0 one-way commit door: readZeroDteLedgerChecked's last-good latch ────────────
// The old readZeroDteLedger swallowed ANY read failure into [], indistinguishable
// from "no plays committed today" — one transient DB blip made every committed play
// vanish from the board payload, and (because committed tickers usually still rank
// in the scan's fresh finds) a member's OPEN card re-rendered as an uncommitted
// watch card. These prove: failure serves the last-good same-session snapshot, and
// a failure with NO snapshot says committed_known:false so consumers fail closed.

test("readZeroDteLedgerChecked: a transient read failure serves the last-good same-session snapshot (committed rows never vanish)", async () => {
  resetState();
  const { readZeroDteLedgerChecked, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerRows = [baseRow({ status: "OPEN" })];
  const first = await readZeroDteLedgerChecked();
  assert.equal(first.committed_known, true);
  assert.equal(first.rows.length, 1);

  // Next build: the DB read blips. Pre-fix this returned [] — the OPEN play gone.
  state.ledgerReadFails = true;
  const second = await readZeroDteLedgerChecked();
  assert.equal(second.committed_known, true, "a same-session snapshot stands in — the committed set is still knowable");
  assert.equal(second.rows.length, 1, "the committed row survives the blip");
  assert.equal(second.rows[0]!.ticker, "NVDA");
});

test("readZeroDteLedgerChecked: failure with NO same-session snapshot is committed_known:false — never a lying empty ledger", async () => {
  resetState();
  const { readZeroDteLedgerChecked, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerReadFails = true;
  const read = await readZeroDteLedgerChecked();
  assert.equal(read.committed_known, false);
  assert.deepEqual(read.rows, []);
});

test("readZeroDteLedger: delegates through the checked read (empty on unknowable, latched rows on a blip)", async () => {
  resetState();
  const { readZeroDteLedger, _resetZeroDteLedgerLatchForTest } = await mod();
  _resetZeroDteLedgerLatchForTest();

  state.ledgerRows = [baseRow({ status: "HOLD" })];
  assert.equal((await readZeroDteLedger()).length, 1);
  state.ledgerReadFails = true;
  assert.equal((await readZeroDteLedger()).length, 1, "latched snapshot serves through the legacy read too");
});

test("gradeZeroDteLedger: an index-root row (SPXW) fetches its close from I:SPX and gets a REAL direction grade", async () => {
  resetState();
  // Prior-session SPXW row, plan already graded (plan_outcome set) so only the
  // direction grade runs. Live numbers from the 2026-07-13 audit: flagged at
  // 7564.68, I:SPX closed 7575.39 → long direction_hit = true.
  state.ungradedRows = [
    baseRow({
      ticker: "SPXW",
      session_date: "2026-07-03",
      underlying_at_flag: 7564.68,
      plan_outcome: "stopped",
      plan_pnl_pct: -50,
      plan_json: { occ: "O:SPXW260703C07565000" },
    }),
  ];
  // Polygon has NO daily bars under the raw root "SPXW" — only under I:SPX.
  // Pre-fix, the scan asked for "SPXW", got [], and stamped a permanent null grade.
  state.dailyBars.set("I:SPX", [{ t: 1751500800000, o: 7547.64, h: 7579.93, l: 7508.16, c: 7575.39 }]);

  const { gradeZeroDteLedger } = await mod();
  const graded = await gradeZeroDteLedger(true);

  assert.equal(graded, 1);
  const daily = state.aggBarCalls.filter((c) => c.timespan === "day");
  assert.deepEqual(
    daily.map((c) => c.symbol),
    ["I:SPX"],
    "the daily-close fetch must use the mapped index symbol, never the raw option root"
  );
  assert.equal(state.gradeCalls.length, 1);
  const grade = state.gradeCalls[0]!.grade as { close_price: number | null; direction_hit: boolean | null; move_pct: number | null };
  assert.equal(grade.close_price, 7575.39, "close must come from the I:SPX bar");
  assert.equal(grade.direction_hit, true, "long from 7564.68 into a 7575.39 close is a hit");
  assert.ok(grade.move_pct != null && grade.move_pct > 0);
});

// Fix 7: a KNOWN index-root row whose mapped I: symbol returns ZERO daily bars (a transient
// provider gap, NOT a real "no close") must be left UNGRADED and retried — NOT stamped
// graded with a permanent null direction. gradeZeroDteSetupRow sets graded_at, so a
// premature stamp freezes the null grade forever (empty results never hit the catch/retry).
test("gradeZeroDteLedger: an index-root row with EMPTY daily bars is left ungraded (retryable), never a permanent null grade", async () => {
  resetState();
  state.ungradedRows = [
    baseRow({
      ticker: "SPXW",
      session_date: "2026-07-03",
      // Plan already graded so only the direction grade runs — isolates the empty-bars path.
      plan_outcome: "stopped",
      plan_pnl_pct: -50,
      plan_json: { occ: "O:SPXW260703C07565000" },
    }),
  ];
  // Seed NO bars for I:SPX → the mock returns [] (empty, not a throw) — the exact prod
  // shape a rate-limited / lagging index fetch produces.
  const { gradeZeroDteLedger } = await mod();
  const graded = await gradeZeroDteLedger(true);

  // It DID try the mapped index symbol...
  assert.deepEqual(
    state.aggBarCalls.filter((c) => c.timespan === "day").map((c) => c.symbol),
    ["I:SPX"]
  );
  // ...but with empty bars it must NOT stamp a grade — leave it for the next pass.
  assert.equal(graded, 0, "an empty-bars index root is not counted graded");
  assert.equal(state.gradeCalls.length, 0, "gradeZeroDteSetupRow must NOT be called — no permanent null stamp");
});

// Guard the boundary: an EQUITY with empty daily bars is a real gap and the clean path is
// unchanged (it still stamps an ungradeable/null grade) — the retry is index-roots only.
test("gradeZeroDteLedger: an EQUITY with empty daily bars still stamps a grade (clean path unchanged — retry is index-roots only)", async () => {
  resetState();
  state.ungradedRows = [
    baseRow({
      ticker: "NVDA",
      session_date: "2026-07-03",
      plan_outcome: "stopped",
      plan_pnl_pct: -50,
      plan_json: { occ: "O:NVDA260703C00145000" },
    }),
  ];
  const { gradeZeroDteLedger } = await mod();
  const graded = await gradeZeroDteLedger(true);
  assert.equal(graded, 1, "an equity with no daily bar is a real gap — still stamped (not retried forever)");
  assert.equal(state.gradeCalls.length, 1);
  assert.equal((state.gradeCalls[0]!.grade as { direction_hit: boolean | null }).direction_hit, null);
});

// ── PR-F commit-time tier stamp (persistZeroDteScan → entry_context.tier) ──────────
// The #325 PR body promised exactly this wiring: "one assignZeroDteTier call at
// commit". buildZeroDteEntryContext (REAL here, like the rest of ./entry-context's
// pure half) pins the tier by feeding the just-built blob through
// tierFromEntryContext, so the ledger row the upsert receives must carry the
// {tier, factors} assignment computed from the SAME values being pinned.

test("persistZeroDteScan: a fresh COMMIT's upserted row pins entry_context.tier from the same pinned evidence", async () => {
  resetState();
  // Day-open VIX 16.1 — the F-1 calm band (15-17). The session-context fetch reads
  // it through the same mocked Polygon provider as everything else in this file.
  state.dailyBars.set("I:VIX", [{ t: Date.parse("2026-07-06T13:30:00Z"), o: 16.1, h: 17, l: 15.8, c: 16.5 }]);

  const setup = {
    ticker: "NVDA",
    direction: "long" as const,
    top_strike: 145,
    expiry: "2026-07-06",
    // Same-day horizon (PR-1) — a 0DTE contract commits; the persist guard drops anything else.
    contract_horizon: "ZERO_DTE" as const,
    actual_dte_at_commit: 0,
    grading_policy: "same_day_1530_close",
    score: 78, // prime band (75-84) — the best measured band
    dossier_score: null,
    conviction: null,
    gross_premium: 2_000_000,
    spike: false,
    underlying_price: 140,
    top_strike_avg_fill: 4.2,
    // WS-14: timestamps the input-age manifest reads at commit (freshest flow print +
    // the name's own last minute bar). The other inputs carry no per-value timestamp here.
    last_seen: "2026-07-06T14:59:30.000Z",
    intraday: { last_bar_ms: Date.parse("2026-07-06T14:59:00.000Z") },
    plan: {
      occ: "O:NVDA260706C00145000",
      flow_avg_fill: 4.2,
      bid: 4.0,
      ask: 4.4,
      mark: 4.2,
      entry_max: 4.2,
      vs_flow_pct: 0,
      entry_status: "IN_RANGE",
      spread_pct: 9.5,
      illiquid: false,
      stop_premium: 2.1,
      target_premium: 8.4,
      time_stop_et: "15:30",
      underlying_target: null,
      underlying_invalid: null,
    },
    gamma_regime: null,
    // Clean multi-source Cortex support at commit (assessment shape — the real
    // cortexEntryContextFor flattens it into the blob the tier engine reads).
    cortex: {
      abstained: false as const,
      decision: "PASS" as const,
      verdict: {
        ticker: "NVDA",
        direction: "long" as const,
        asOf: "2026-07-06T15:00:00.000Z",
        score: 2.1,
        conviction: "A" as const,
        vetoes: [],
        supports: [
          { source: "gex-walls", stance: "supports", weight: 1.0, halfLifeSec: 900, asOf: "2026-07-06T15:00:00.000Z", detail: "path clear" },
          { source: "wall-trend", stance: "supports", weight: 1.1, halfLifeSec: 900, asOf: "2026-07-06T15:00:00.000Z", detail: "wall growing" },
        ],
        opposes: [],
        absent: [],
        narrative: [],
      },
    },
    gate: {
      verdict: "COMMIT" as const,
      blocks: [],
      calibration: {
        score_at_commit: 78,
        market_bias: "up",
        committed_at_et: "11:30",
        g4_vix: { day_open_vix: 16.1, tier: "calm", would_block: false, would_halve_size: false, note: "calm" },
        g6_conflict: { conflict: false, against: [], would_block: false, note: "No cross-system conflict." },
      },
    },
    earnings: null,
    news_hot: null,
    halted: false,
    fib_note: null,
    direction_confirmed: null,
  };

  const { persistZeroDteScan } = await mod();
  const logged = await persistZeroDteScan([setup as never]);

  assert.equal(logged, 1);
  assert.equal(state.upsertRows.length, 1);
  const ctx = state.upsertRows[0]!.entry_context as {
    score: number | null;
    vix_open: number | null;
    tier: { tier: string; factors: Array<{ label: string; direction: string }> } | null;
  };
  assert.equal(ctx.score, 78);
  assert.equal(ctx.vix_open, 16.1);
  // HORIZON (PR-1): the same-day horizon is pinned to entry_context AND the feature vector so the
  // graded ledger can assert same-day before applying the 15:30 time-stop, and the feature store
  // stays structurally homogeneous (only ZERO_DTE/ONE_DTE ever land).
  const hctx = state.upsertRows[0]!.entry_context as {
    contract_horizon?: string;
    actual_dte_at_commit?: number;
    grading_policy?: string;
  };
  assert.equal(hctx.contract_horizon, "ZERO_DTE");
  assert.equal(hctx.actual_dte_at_commit, 0);
  assert.equal(hctx.grading_policy, "same_day_1530_close");
  const fv = state.upsertRows[0]!.feature_vector as {
    contract_horizon?: string;
    actual_dte_at_commit?: number;
  };
  assert.equal(fv.contract_horizon, "ZERO_DTE");
  assert.equal(fv.actual_dte_at_commit, 0);
  // WS-14: the commit freezes an input_age_manifest with EVERY key present — a real age
  // for the inputs whose timestamp reached commit (flow/underlying), null for the ones
  // whose age is genuinely unknown here (never fabricated).
  const manifest = (state.upsertRows[0]!.entry_context as { input_age_manifest?: Record<string, number | null> })
    .input_age_manifest;
  assert.ok(manifest, "entry_context must carry the WS-14 input_age_manifest");
  assert.deepEqual(Object.keys(manifest!).sort(), [
    "flow",
    "gex",
    "macro",
    "option_quote",
    "spy_bias",
    "underlying",
    "vix",
  ]);
  assert.equal(typeof manifest!.flow, "number"); // last_seen present → a real age
  assert.equal(typeof manifest!.underlying, "number"); // intraday.last_bar_ms present → a real age
  assert.equal(manifest!.option_quote, null);
  assert.equal(manifest!.gex, null);
  assert.equal(manifest!.vix, null);
  assert.equal(manifest!.macro, null);
  assert.equal(manifest!.spy_bias, null);
  // Prime score (+2) + calm VIX (+2) + clean Cortex (+2) ≥ the A bar even with the
  // early-window penalty (committed_at_et is stamped from the REAL clock, so the
  // F-4 factor's presence depends on when this test runs — the tier does not).
  assert.ok(ctx.tier, "the commit-time tier must be pinned alongside the evidence it ranks");
  assert.equal(ctx.tier!.tier, "A");
  const labels = ctx.tier!.factors.map((f) => f.label);
  for (const expected of ["Prime score band", "VIX calm band", "Clean Cortex support"]) {
    assert.ok(labels.includes(expected), `factor "${expected}" must argue the tier (got: ${labels.join(", ")})`);
  }
});

// ── Condor entry_premium persistence (bug found 2026-08-26) ────────────────────────
// A condor row's s.plan/s.top_strike_avg_fill are always null (no single-leg plan), so
// resolveLedgerEntryPremium(null, null, null) used to return null for EVERY committed
// condor — permanently (COALESCE-pinned at first write). aggregatePremiumAtRisk
// (governor.ts) sums entry_premium across open rows, so an open condor's real risk was
// silently invisible to the governor's session premium-at-risk budget the whole time it
// was open. net_credit is priced $×100-per-contract; entry_premium is per-share
// throughout this ledger, so the persisted value must be net_credit/100.
test("persistZeroDteScan: a committed CONDOR row persists entry_premium from net_credit (was permanently null)", async () => {
  resetState();
  state.dailyBars.set("I:VIX", [{ t: Date.parse("2026-07-06T13:30:00Z"), o: 16.1, h: 17, l: 15.8, c: 16.5 }]);

  const setup = {
    ticker: "SPY",
    direction: "short" as const,
    play_type: "CONDOR" as const,
    top_strike: null,
    expiry: "2026-07-06",
    contract_horizon: "ZERO_DTE" as const,
    actual_dte_at_commit: 0,
    grading_policy: "same_day_1530_close",
    score: 78,
    dossier_score: null,
    conviction: null,
    gross_premium: 0,
    spike: false,
    underlying_price: 550,
    top_strike_avg_fill: null,
    plan: null,
    condor_plan: {
      play_type: "CONDOR" as const,
      expiry: "2026-07-06",
      dte: 0,
      spot: 550,
      short_put: 545,
      long_put: 543,
      short_call: 555,
      long_call: 557,
      put_width_pct: 0.36,
      call_width_pct: 0.36,
      wing_pts: 2,
      legs: [],
      net_credit: 80, // $80/contract ($×100 units) — $0.80/share
      gross_wing_risk: 200,
      max_loss: 120,
      credit_to_risk: 0.4,
      net_credit_mid: 85,
      credit_to_risk_mid: 0.425,
      breach_lower: 545,
      breach_upper: 555,
    },
    gamma_regime: null,
    cortex: null,
    gate: { verdict: "COMMIT" as const, blocks: [], calibration: null },
    earnings: null,
    news_hot: null,
    halted: false,
    fib_note: null,
    direction_confirmed: null,
  };

  const { persistZeroDteScan } = await mod();
  const logged = await persistZeroDteScan([setup as never]);

  assert.equal(logged, 1);
  assert.equal(state.upsertRows.length, 1);
  assert.equal(state.upsertRows[0]!.entry_premium, 0.8, "net_credit ($80, ×100 units) → 0.80/share, matching directional entry_premium's per-share convention");
});

// ── HORIZON INTEGRITY fail-closed commit guard (PR-1) ──────────────────────────────
test("persistZeroDteScan DROPS a WEEKLY_FALLBACK (dte≥2) candidate — never committed, never graded same-day", async () => {
  resetState();
  // A candidate whose selected contract is a 5-DTE weekly. Even if it carried a COMMIT gate verdict,
  // the horizon guard must drop it BEFORE any ledger write so a 5-DTE contract can't be graded with
  // the 0DTE 15:30 time-stop (invalid outcome + polluted calibration). The guard returns before it
  // reads any other field, so a minimal literal exercises exactly the drop path.
  const weekly = {
    ticker: "NVDA",
    direction: "long" as const,
    contract_horizon: "WEEKLY_FALLBACK" as const,
    actual_dte_at_commit: 5,
    grading_policy: "excluded_non_same_day",
    gate: { verdict: "COMMIT" as const, blocks: [], calibration: {} },
    play_type: "DIRECTIONAL" as const,
  };
  const { persistZeroDteScan } = await mod();
  const logged = await persistZeroDteScan([weekly as never]);
  assert.equal(logged, 0, "a weekly-fallback candidate must not be committed");
  assert.equal(state.upsertRows.length, 0, "no ledger row is written for an excluded weekly");
});

// ── AUDIT SEV-3 realized-loss halt — the ENFORCEMENT WIRING (scan.ts → gate stack) ──
// Regression guard for the inert-halt bug: PR #1056 added governorLossHaltReason
// (halt on ≥3 realized losers OR a session-P&L floor) and deriveGovernorFromLedger
// correctly COMPUTES realized_losers/session_pnl_pct — but scan.ts's attachGateVerdicts
// built the ENFORCEMENT snapshot as a hand-written literal that copied ONLY open_plans +
// stops and DROPPED those two fields. Because they're optional on GovernorSnapshot
// (read as 0 when absent), the loss-halt read 0 losers / 0% and could NEVER fire in the
// live commit path — while the board strip showed "halted" from a separately, correctly
// derived snapshot (summarizeGovernorForBoard). The unit tests in governor.test.ts pass
// a snapshot in directly, so they never exercised this construction; only driving the
// real scanZeroDteBoard pipeline touches the seam.
//
// Ledger fixture: FIVE losing TIME-STOPS (CLOSED, plan_pnl_pct < 0, NONE at the −50%
// hard-stop level) → realized_losers 5 (trips the count cap of 5) BUT stops.length 0 (the
// hard-stop halt stays untripped) and session_pnl_pct −150 (above the −120 floor — wait,
// 5×−30 = −150 < −120 so the pnl floor also fires). That isolates EXACTLY the channel the
// dropped fields disabled: pre-fix this NVDA candidate commits freely; post-fix the
// loss-halt block rides on its gate verdict.
function losingTimeStop(ticker: string): LedgerRow {
  // CLOSED and red, but trough (3.5) is well above the plan's −50% stop level
  // (entry 4.2 × 0.5 = 2.1), so ledgerRowStopped() is false → it counts as a realized
  // LOSER without counting as a hard STOP. plan_outcome left null (not "stopped").
  return baseRow({
    ticker,
    status: "CLOSED",
    plan_outcome: null,
    plan_pnl_pct: -30,
    entry_premium: 4.2,
    trough_premium: 3.5,
    last_mark: 3.0,
  });
}

test("scanZeroDteBoard: 5 realized losing time-stops no longer HALT a fresh commit (GOVERNOR_ENFORCE_LOSS_HALT disabled by default, 2026-08-27 operator directive) — the enforcement snapshot still carries realized_losers/session_pnl_pct (SEV-3 wiring, now diagnostic-only)", async () => {
  resetState();
  // Ledger = five losing time-stops on OTHER tickers (so NVDA is a genuinely fresh,
  // un-committed candidate the gate stack will judge).
  state.ledgerRows = [losingTimeStop("AAA"), losingTimeStop("BBB"), losingTimeStop("CCC"), losingTimeStop("DDD"), losingTimeStop("EEE")];

  // A clean, unambiguous NVDA 0DTE call print that survives deriveZeroDteSetups' evidence
  // gates: gross $2M (> 750k min), 100% at-the-ask (aggression 1.0, all calls → dominance
  // 1.0), a live underlying, and a near-ATM strike (well inside the ITM band).
  state.flows = [
    {
      ticker: "NVDA",
      premium: 2_000_000,
      option_type: "call",
      strike: 145,
      expiry: "2026-07-06", // == mocked todayEt → a live 0DTE expiry
      dte: 0,
      alert_rule: "sweep",
      ask_pct: 75, // ≥ 60 → full aggression weight
      underlying_price: 140,
      fill_price: 4.2,
      open_interest: 100,
      alerted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];

  const { scanZeroDteBoard } = await mod();
  const result = (await scanZeroDteBoard()) as {
    setups: Array<{ ticker: string; gate?: { verdict: string; blocks: Array<{ code: string; reason: string }> } | null }>;
  };

  const nvda = result.setups.find((s) => s.ticker.toUpperCase() === "NVDA");
  assert.ok(nvda, "the NVDA flow print must survive discovery into a gated setup");
  assert.ok(nvda!.gate, "a fresh (un-committed) candidate must get a gate verdict");

  // GOVERNOR_ENFORCE_LOSS_HALT defaults to false (2026-08-27 operator directive: testing/
  // pre-launch phase, no aggressive live 0DTE users yet — keep producing plays regardless of
  // realized losses). The loss-halt block must therefore be ABSENT from a fresh candidate's
  // gate trace even on a 5-realized-loser day — this is the mirror image of the pre-fix
  // regression this test used to guard (a dropped realized_losers field silently prevented the
  // block from ever firing; now it is INTENTIONALLY not enforced, a different fact).
  const lossHalt = nvda!.gate!.blocks.find((b) => b.code === "governor_session_loss_halt");
  assert.equal(lossHalt, undefined, "the loss-halt channel is measure-only by default -- it must not block a fresh commit");
});

// ── Phase 3a: with the whole-market flags OFF, the board is flow-only + every setup is ["FLOW"] ──
// Byte-for-byte discovery-behavior guard: no breakout source runs (breakout-discovery is never even
// imported — it's only dynamic-imported when the flags are on, so this test needs no polygon/chain
// mocks), and every discovered setup carries the FLOW origin stamp.
test("scanZeroDteBoard: flags OFF → flow-only board, every setup stamped discovery_origin [\"FLOW\"]", async () => {
  resetState();
  delete process.env.ZERODTE_WHOLE_MARKET;
  delete process.env.ZERODTE_SRC_BREAKOUT;
  delete process.env.ZERODTE_SRC_PIN; // Phase 3b: the pin source is off too — no PIN origin appears
  state.flows = [
    {
      ticker: "NVDA",
      premium: 2_000_000,
      option_type: "call",
      strike: 145,
      expiry: "2026-07-06",
      dte: 0,
      alert_rule: "sweep",
      ask_pct: 75,
      underlying_price: 140,
      fill_price: 4.2,
      open_interest: 100,
      alerted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];

  const { scanZeroDteBoard } = await mod();
  const result = (await scanZeroDteBoard()) as {
    setups: Array<{ ticker: string; discovery_origin: string[] }>;
  };
  assert.ok(result.setups.length >= 1);
  for (const s of result.setups) {
    assert.deepEqual(s.discovery_origin, ["FLOW"], `${s.ticker} must be flow-only with the flags off`);
  }
});

// ── G-11 firewall: halt/earnings for EVERY committable rank, not just the dossier top-5 ──
// Pre-fix, ranks 6-10 never received a dossier (halt) and the cron commit path passed NO
// earnings flags at all — so an earnings-today name outside the top-5 committed blind. The
// firewall fetches cheap batch halt/earnings for every FRESH candidate in attachGateVerdicts.
test("scanZeroDteBoard: an earnings-today name at RANK 7 is blocked by G-11 (batch earnings reaches ranks 6-10)", async () => {
  resetState();
  // Six higher-premium clean call setups (rank 1-6) + one lower-premium earnings name that
  // sorts LAST (rank 7, outside the top-5 dossier enrichment). Each is a single at-the-ask
  // 0DTE call print that survives deriveZeroDteSetups' evidence gates.
  const cleanFlow = (ticker: string, premium: number) => ({
    ticker,
    premium,
    option_type: "call",
    strike: 145, // ~3.6% OTM vs 140 — inside the moneyness caps
    expiry: "2026-07-06", // == mocked todayEt (a live 0DTE expiry)
    dte: 0,
    alert_rule: "sweep",
    ask_pct: 75,
    underlying_price: 140,
    fill_price: 4.2,
    open_interest: 100,
    alerted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  state.flows = [
    cleanFlow("AAA", 3_000_000),
    cleanFlow("BBB", 2_900_000),
    cleanFlow("CCC", 2_800_000),
    cleanFlow("DDD", 2_700_000),
    cleanFlow("EEE", 2_600_000),
    cleanFlow("FFF", 2_500_000),
    cleanFlow("GGG", 2_400_000),
    cleanFlow("HHH", 2_300_000),
    cleanFlow("III", 2_200_000),
    cleanFlow("JJJ", 2_100_000),
    cleanFlow("KKK", 2_000_000),
    cleanFlow("LLL", 1_900_000),
    // Lowest premium → sorts past ENRICH_TOP_N (12) so it has no dossier enrichment.
    cleanFlow("ERNZ", 1_000_000),
  ];
  // ERNZ reports TODAY — the batch earnings snapshot flags it even though it gets no dossier.
  state.earningsItems = [
    { ticker: "ERNZ", when: "premarket", report_date: "2026-07-06", expected_move_pct: 8 },
  ];

  const { scanZeroDteBoard } = await mod();
  const result = (await scanZeroDteBoard()) as {
    setups: Array<{ ticker: string; gate?: { verdict: string; blocks: Array<{ code: string; reason: string }> } | null }>;
  };

  const ernzIdx = result.setups.findIndex((s) => s.ticker.toUpperCase() === "ERNZ");
  assert.ok(ernzIdx >= 0, "ERNZ must survive discovery into a gated setup");
  assert.ok(ernzIdx >= 12, `ERNZ must rank outside the top-12 (dossier-less) — got index ${ernzIdx}`);
  const ernz = result.setups[ernzIdx]!;
  assert.ok(ernz.gate, "a fresh (un-committed) candidate must get a gate verdict");
  assert.equal(
    ernz.gate!.blocks.some((b) => b.code === "earnings"),
    true,
    "G-11 earnings must fire for a rank-7 name — pre-fix, ranks 6-10 got earnings:null and committed blind"
  );
  assert.equal(ernz.gate!.verdict, "BLOCKED");
});

// ── D2 firewall: a COLD halt FEED fails a fresh commit closed for EVERY committable rank ──────
// Root cause: attachGateVerdicts read the board halt with failClosedOnStale:false, so a dark/dead
// halt socket (post-deploy, or died mid-session) left the store empty and a HALTED underlying could
// commit a fresh 0DTE. The fix ALSO surfaces isTradingHaltChannelStale() → haltFeedStale, and G-11
// fails the fresh commit closed under a distinct `halt_feed_stale` code. This drives the REAL
// scanZeroDteBoard pipeline (not a hand-built snapshot) so it exercises the exact read seam.
//
// FAIL-BEFORE: the mocked shouldBlockForTradingHalt returns active-halt ONLY (ignores stale) —
// exactly like scan.ts's failClosedOnStale:false read — so the OLD scan (which never read
// staleness) produced NO halt_feed_stale block here and this NVDA candidate ran the gates as if
// the halt feed were fine. PASS-AFTER: haltFeedStale=true now blocks it.
//
// HERMETICITY: scan.ts reads the halt inside a Promise.all via a CONCURRENT dynamic
// import("@/lib/ws/uw-socket"), and its catch fails OPEN (feedStale:false) by design (a crash must
// not empty the board). Under full-suite CPU contention the experimental module-mock loader can
// intermittently reject that concurrent import → the catch silently drops the block → this
// assertion flakes (the D1 earnings sibling doesn't, because ITS catch fails CLOSED). We pin it by
// PRE-WARMING the mocked module below so the in-scan import is a pure module-cache hit (no loader
// round-trip, so no race). This is test-only hardening — the D2 production logic is unchanged and
// the deterministic gate-level contract lives in gates.test.ts "G-11 D2: …".
test("scanZeroDteBoard: a COLD halt feed (both sources stale) fails a fresh commit closed with `halt_feed_stale`", async () => {
  resetState();
  state.haltFeedStale = true; // isTradingHaltChannelStale() → true (UW + LULD both cold)
  await import("../ws/uw-socket"); // pre-warm the mocked module → in-scan dynamic import hits cache
  // A clean NVDA 0DTE call print that survives discovery — NO active halt on the name (the store
  // is empty precisely BECAUSE the feed is dark). Pre-fix this committed blind past the dead feed.
  state.flows = [
    {
      ticker: "NVDA",
      premium: 2_000_000,
      option_type: "call",
      strike: 145,
      expiry: "2026-07-06", // == mocked todayEt → a live 0DTE expiry
      dte: 0,
      alert_rule: "sweep",
      ask_pct: 75,
      underlying_price: 140,
      fill_price: 4.2,
      open_interest: 100,
      alerted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];

  const { scanZeroDteBoard } = await mod();
  const result = (await scanZeroDteBoard()) as {
    setups: Array<{ ticker: string; gate?: { verdict: string; blocks: Array<{ code: string; reason: string }> } | null }>;
  };
  const nvda = result.setups.find((s) => s.ticker.toUpperCase() === "NVDA");
  assert.ok(nvda, "the NVDA flow print must survive discovery into a gated setup");
  assert.ok(nvda!.gate, "a fresh (un-committed) candidate must get a gate verdict");
  assert.equal(
    nvda!.gate!.blocks.some((b) => b.code === "halt_feed_stale"),
    true,
    "a cold halt feed must fire G-11 halt_feed_stale — pre-D2 the failClosedOnStale:false read " +
      "never saw staleness and this candidate committed past a dead halt socket"
  );
  assert.equal(nvda!.gate!.verdict, "BLOCKED", "a blind halt feed must not COMMIT a fresh play");
});

// ── D2 NO-STARVE (the critical safety property): a HEALTHY feed never fires halt_feed_stale ────
// On a normal session the halt CHANNEL is naturally silent (trading_halts is event-only), but the
// socket is healthy — flow/price/tide stream constantly — so isTradingHaltChannelStale() reads
// FRESH via the cross-channel effectiveFreshestUwMessageAt() proxy, NOT the halt channel's own
// heartbeat. haltFeedStale stays false and the halt firewall adds NOTHING to the gate. This proves
// the fix does NOT empty the board on a quiet-halt day (the edition-builder trap). (The full
// COMMIT-through no-starve is pinned at the gate unit in gates.test.ts "G-11 D2: healthy feed …".)
test("scanZeroDteBoard: a HEALTHY halt feed (quiet channel, socket live) adds NO halt_feed_stale block — no board starvation", async () => {
  resetState();
  state.haltFeedStale = false; // healthy socket → isTradingHaltChannelStale() false
  await import("../ws/uw-socket"); // pre-warm the mocked module (same hermeticity guard as above)
  state.flows = [
    {
      ticker: "NVDA",
      premium: 2_000_000,
      option_type: "call",
      strike: 145,
      expiry: "2026-07-06",
      dte: 0,
      alert_rule: "sweep",
      ask_pct: 75,
      underlying_price: 140,
      fill_price: 4.2,
      open_interest: 100,
      alerted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ];

  const { scanZeroDteBoard } = await mod();
  const result = (await scanZeroDteBoard()) as {
    setups: Array<{ ticker: string; gate?: { verdict: string; blocks: Array<{ code: string; reason: string }> } | null }>;
  };
  const nvda = result.setups.find((s) => s.ticker.toUpperCase() === "NVDA");
  assert.ok(nvda, "the NVDA flow print must survive discovery into a gated setup");
  assert.ok(nvda!.gate, "a fresh (un-committed) candidate must get a gate verdict");
  assert.equal(
    nvda!.gate!.blocks.some((b) => b.code === "halt_feed_stale"),
    false,
    "a healthy halt feed must NOT manufacture a halt_feed_stale block — the fix must not starve the board"
  );
});

// ── WS-01 governor commit atomicity (transactional recount + re-evaluate) ────────────
// The session governor (GOVERNOR_MAX_CONCURRENT_PLANS, default 100) is evaluated against an open-book
// snapshot read at scan START, then persistZeroDteScan re-reads the pre-cycle book and inserts
// with no DB-level serialization in between. Two overlapping commits (member-poll + cron warm,
// or two replicas) could each see "room for 1 more" and BOTH insert past the cap. The fix runs
// the fresh-commit count→evaluate→insert inside a Postgres xact advisory lock and RE-DERIVES the
// governor from a fresh in-transaction ledger read before inserting. These two tests exercise
// the recount+re-evaluate seam directly (the DB txn/lock is stubbed; the pure decision is real):
// one proves the uncontended path is behavior-identical, the other proves a racing writer's
// committed rows (surfaced via the in-transaction recount) drop the over-cap loser.

/** A minimal FRESH, COMMIT-gated same-day setup — everything persistZeroDteScan reads to build
 *  and commit a fresh row. Mirrors the PR-F literal above; only ticker/score/direction vary. */
function freshCommitSetup(ticker: string, score: number, direction: "long" | "short" = "long") {
  const strike = direction === "long" ? 145 : 135;
  return {
    ticker,
    direction,
    top_strike: strike,
    expiry: "2026-07-06",
    contract_horizon: "ZERO_DTE" as const,
    actual_dte_at_commit: 0,
    grading_policy: "same_day_1530_close",
    score,
    dossier_score: null,
    conviction: null,
    gross_premium: 2_000_000,
    spike: false,
    underlying_price: 140,
    top_strike_avg_fill: 4.2,
    last_seen: "2026-07-06T14:59:30.000Z",
    intraday: { last_bar_ms: Date.parse("2026-07-06T14:59:00.000Z") },
    plan: {
      occ: `O:${ticker}260706C00145000`,
      flow_avg_fill: 4.2,
      bid: 4.0,
      ask: 4.4,
      mark: 4.2,
      entry_max: 4.2,
      vs_flow_pct: 0,
      entry_status: "IN_RANGE",
      spread_pct: 9.5,
      illiquid: false,
      stop_premium: 2.1,
      target_premium: 8.4,
      time_stop_et: "15:30",
      underlying_target: null,
      underlying_invalid: null,
    },
    gamma_regime: null,
    cortex: null,
    gate: { verdict: "COMMIT" as const, blocks: [], calibration: {} },
    earnings: null,
    news_hot: null,
    halted: false,
    fib_note: null,
    direction_confirmed: null,
  };
}

/** A currently-OPEN ledger row (non-CLOSED, un-stopped) — a live plan the governor counts as
 *  one unit of concurrent exposure. Uses non-index tickers so no correlated-conflict fires. */
function openLedgerRow(ticker: string, direction: "long" | "short" = "long"): Record<string, unknown> {
  return {
    session_date: "2026-07-06",
    ticker,
    direction,
    status: "OPEN",
    entry_premium: 4.2,
    trough_premium: null,
    plan_outcome: null,
    plan_pnl_pct: null,
  };
}

test("WS-01 persistZeroDteScan: UNCONTENDED — the in-transaction recount equals the scan-time snapshot, so the SAME fresh candidates commit (behavior-identical)", async () => {
  resetState();
  state.dailyBars.set("I:VIX", [{ t: Date.parse("2026-07-06T13:30:00Z"), o: 16.1, h: 17, l: 15.8, c: 16.5 }]);
  // Pre-cycle book: ONE open plan (a non-index name). With the 3-concurrent cap that leaves
  // room for two more, so both fresh candidates below fit — exactly as the scan-time gate saw.
  state.ledgerRows = [openLedgerRow("AAPL")];
  // atomicLedger stays null → the recount reads the SAME one-open book (no concurrent writer).

  const { persistZeroDteScan } = await mod();
  const logged = await persistZeroDteScan([
    freshCommitSetup("NVDA", 80) as never,
    freshCommitSetup("AMD", 70) as never,
  ]);
  await new Promise((r) => setTimeout(r, 0)); // let the best-effort rejection write flush

  // Both fresh candidates commit (1 open + 2 fresh = 3, at but not over the cap) — identical to
  // what today's non-atomic path would have inserted when uncontended.
  const committed = state.atomicSelectedRows.map((r) => String(r.ticker).toUpperCase()).sort();
  assert.deepEqual(committed, ["AMD", "NVDA"]);
  assert.equal(logged, 2);
  // No recount drop → no governor rejection recorded.
  assert.equal(state.rejectionRows.length, 0);
});

test("WS-01 persistZeroDteScan: RACE — a concurrent writer's committed rows (seen only via the in-transaction recount) leave ONE slot, so only ONE fresh play is admitted and the lower-score loser is rejected with a governor reason", async () => {
  resetState();
  const { GOVERNOR_MAX_CONCURRENT_PLANS } = await import("./governor");
  state.dailyBars.set("I:VIX", [{ t: Date.parse("2026-07-06T13:30:00Z"), o: 16.1, h: 17, l: 15.8, c: 16.5 }]);
  // At SCAN start: ceiling-2 open → BOTH fresh candidates still clear the pre-persist gate.
  const atScan = Array.from({ length: GOVERNOR_MAX_CONCURRENT_PLANS - 2 }, (_, i) => openLedgerRow(`T${i}`));
  state.ledgerRows = atScan;
  // By the time we hold the commit lock a RACING writer has already filled one more seat.
  // Transactional recount → ceiling-1 open, one slot left.
  state.atomicLedger = [...atScan, openLedgerRow("GOOGL")];

  const { persistZeroDteScan } = await mod();
  await persistZeroDteScan([
    freshCommitSetup("NVDA", 80) as never, // higher score — offered the last slot first
    freshCommitSetup("AMD", 70) as never, // lower score — recount blocks it at the cap
  ]);
  await new Promise((r) => setTimeout(r, 0)); // flush the best-effort rejection write

  // Exactly ONE fresh play admitted — the higher-score NVDA.
  const committed = state.atomicSelectedRows.map((r) => String(r.ticker).toUpperCase());
  assert.deepEqual(committed, ["NVDA"]);
  // The loser is DROPPED (never inserted) and durably recorded as a governor block — fail-VISIBLE.
  assert.equal(state.upsertRows.some((r) => String(r.ticker).toUpperCase() === "AMD"), false);
  const amdRej = state.rejectionRows.find((r) => String(r.ticker).toUpperCase() === "AMD");
  assert.ok(amdRej, "the over-cap loser must be recorded to zerodte_scan_rejections");
  assert.equal(amdRej!.gate_failed, "governor_max_concurrent");
  assert.match(String(amdRej!.reason), new RegExp(`max ${GOVERNOR_MAX_CONCURRENT_PLANS} concurrent`));
});

// ── D3 · option-quote staleness plumbing ─────────────────────────────────────────
// computeQuoteAgeMs is the scan's bridge between OptionSnapshot.quoteUpdatedMs (last_quote
// .last_updated, ns→ms) and the WS-04 `stale` predicate on buildContractPlan. It must:
//  - return undefined when there is NO timestamp (predicate dormant — absence ≠ stale),
//  - floor a negative age (provider/our clock skew) to 0 = fresh (skew never trips stale),
//  - otherwise report the real age. Below also proves the END-TO-END wiring: the age it
//    derives, fed into the REAL buildContractPlan, produces the stale reason (and only then).

test("D3 computeQuoteAgeMs: missing → undefined, fresh/stale reported, negative skew floored to 0", async () => {
  const { computeQuoteAgeMs } = await mod();
  const now = 1_784_923_200_000;
  // No timestamp → undefined (dormant), for both null and undefined inputs.
  assert.equal(computeQuoteAgeMs(null, now), undefined);
  assert.equal(computeQuoteAgeMs(undefined, now), undefined);
  // Fresh: 5s old.
  assert.equal(computeQuoteAgeMs(now - 5_000, now), 5_000);
  // Stale: 90s old.
  assert.equal(computeQuoteAgeMs(now - 90_000, now), 90_000);
  // Negative (quote clock ahead of ours) → floored to 0, NOT a negative/huge age.
  assert.equal(computeQuoteAgeMs(now + 10_000, now), 0);
});

test("G-9 observation clock: just-fetched book stays fresh even when exchange last_updated is hours old", async () => {
  const { computeQuoteAgeMs } = await mod();
  const { QUOTE_VALIDITY } = await import("./plan");
  const now = 1_784_923_200_000;
  const exchangeUpdatedMs = now - 4 * 60 * 60 * 1000; // prior session stamp
  const observedAtMs = now - 500; // REST observation this cycle
  assert.ok((computeQuoteAgeMs(exchangeUpdatedMs, now) ?? 0) > QUOTE_VALIDITY.max_quote_age_ms);
  // Commit path: observedAtMs ?? quoteUpdatedMs → fresh (the live attach wiring).
  assert.equal(computeQuoteAgeMs(observedAtMs ?? exchangeUpdatedMs, now), 500);
});

test("D3 integration: computeQuoteAgeMs(quoteUpdatedMs) drives buildContractPlan's stale verdict", async () => {
  const { computeQuoteAgeMs } = await mod();
  const { buildContractPlan, QUOTE_VALIDITY } = await import("./plan");
  const base = {
    occ: "O:QQQ260713C00500000",
    direction: "long" as const,
    price: 500,
    flowAvgFill: 2,
    bid: 2.3,
    ask: 2.5,
    mark: 2.4,
    keySupports: [] as number[],
    keyResistances: [] as number[],
    vwap: null,
  };
  const now = 1_784_923_200_000;

  // STALE: a quote stamped just beyond the age bound → the derived age trips `stale`.
  const staleUpdated = now - (QUOTE_VALIDITY.max_quote_age_ms + 5_000);
  const stalePlan = buildContractPlan({ ...base, quoteAgeMs: computeQuoteAgeMs(staleUpdated, now) });
  assert.equal(stalePlan.quote_invalid_reason, "stale");

  // FRESH: a quote inside the bound → commits.
  const freshPlan = buildContractPlan({ ...base, quoteAgeMs: computeQuoteAgeMs(now - 5_000, now) });
  assert.equal(freshPlan.quote_invalid_reason, null);

  // MISSING: no snapshot timestamp → undefined age → predicate dormant → NOT blocked.
  const noTs = buildContractPlan({ ...base, quoteAgeMs: computeQuoteAgeMs(null, now) });
  assert.equal(noTs.quote_invalid_reason, null);
});

// Regression for a P1 finding (2026-09-02, live monitor): attachIntradayEdge adjusts a
// BREAKOUT setup's `score` (time-of-day + market-align + intraday-VWAP nudges) AFTER
// breakoutScoreBreakdown already pinned `factor_breakdown` to sum to the pre-adjustment score —
// so the deck's "Why this play was picked" panel silently drifted +5/+15 off its own listed
// factors on 50/54 live BREAKOUT setups. applyIntradayEdgeToBreakdown is the extracted, pure
// piece of that fix: it must add the adjustment back as its own named factor ONLY for
// breakoutScoreBreakdown's shape (detected via the `breakout_core` key), and leave any other
// breakdown (FLOW/PIN, which reconciles to the separate `dossier_score` field, not `score`)
// completely untouched.
test("applyIntradayEdgeToBreakdown adds the applied delta as its own factor for a BREAKOUT breakdown", async () => {
  const { applyIntradayEdgeToBreakdown } = await mod();
  const breakdown = { breakout_core: 40, dollar_volume: 20, screen_base: 10 }; // sums to 70
  const updated = applyIntradayEdgeToBreakdown(breakdown, 5);
  assert.deepEqual(updated, { breakout_core: 40, dollar_volume: 20, screen_base: 10, intraday_edge: 5 });
  // The invariant this fix restores: the parts sum to the post-adjustment score exactly.
  const sum = Object.values(updated!).reduce((a, b) => a + b, 0);
  assert.equal(sum, 75, "breakdown must reconcile to the post-adjustment score (70 + 5)");
});

test("applyIntradayEdgeToBreakdown leaves a FLOW/PIN breakdown untouched (reconciles to dossier_score, not score)", async () => {
  const { applyIntradayEdgeToBreakdown } = await mod();
  const flowBreakdown = { flow: 30, tech: 18, positioning: 10, news: 8, smart_money: 12 };
  const updated = applyIntradayEdgeToBreakdown(flowBreakdown, 5);
  assert.deepEqual(updated, flowBreakdown, "a non-BREAKOUT breakdown must never gain a stray intraday_edge entry");
});

test("applyIntradayEdgeToBreakdown is a no-op on a zero delta or a null breakdown", async () => {
  const { applyIntradayEdgeToBreakdown } = await mod();
  const breakdown = { breakout_core: 40, dollar_volume: 20, screen_base: 10 };
  assert.deepEqual(applyIntradayEdgeToBreakdown(breakdown, 0), breakdown);
  assert.equal(applyIntradayEdgeToBreakdown(null, 5), null);
});

test("applyIntradayEdgeToBreakdown uses the post-clamp applied delta, not the raw adjustment sum", async () => {
  // If the caller passes the ACTUAL score delta (score_after - score_before, which already
  // accounts for the Math.max(0, Math.min(100, ...)) clamp in attachIntradayEdge), the
  // breakdown reconciles exactly even when a setup was clamped at the 0-100 boundary — e.g. a
  // setup already at score 98 with a +7 raw adjustment sum only actually moves to 100 (+2
  // applied), and the breakdown must show +2, not +7.
  const { applyIntradayEdgeToBreakdown } = await mod();
  const breakdown = { breakout_core: 88, dollar_volume: 8, screen_base: 2 }; // sums to 98
  const updated = applyIntradayEdgeToBreakdown(breakdown, 2); // caller passes the CLAMPED delta
  const sum = Object.values(updated!).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100, "must reconcile to the clamped score (100), not an over-counted 105");
});
