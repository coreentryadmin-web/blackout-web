import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("zerodte board route delegates to getZeroDteBoardPayload (single derivation)", () => {
  const route = readFileSync(join(ROOT, "app/api/market/zerodte/board/route.ts"), "utf8");
  assert.match(route, /getZeroDteBoardPayload/);
  assert.doesNotMatch(route, /scanZeroDteBoard/);
  assert.doesNotMatch(route, /buildBoardPayload/);
});

test("Largo get_zerodte_plays delegates to zeroDtePlaysForLargo in zerodte-service", () => {
  const runTool = readFileSync(join(ROOT, "lib/largo/run-tool.ts"), "utf8");
  assert.match(runTool, /zeroDtePlaysForLargo/);
  const service = readFileSync(join(ROOT, "lib/platform/zerodte-service.ts"), "utf8");
  assert.match(service, /getZeroDteBoardPayload/);
  assert.match(service, /buildIntelNote/);
  assert.match(service, /nowEtMinutes/);
  assert.match(service, /lastMark/);
});

// P1 regression guard (FINDINGS.md): zeroDtePlaysForLargo()'s "fresh find" block
// used to compute its own OPEN/SKIP status checking ONLY entry_status === "MOVED" —
// missing the time-of-day cutoff (POWER_HOUR/LATE_SESSION/CLOSED) and illiquid gate
// ZeroDteBoard.tsx's mergePlays() already applied, so Largo/BIE could tell a member
// "ADD" (buy) for a fresh find the board itself showed as SKIP/watch-only. Fixed by
// sharing resolveFreshFindStatus() (board.ts) between both consumers — this asserts
// the shared call site, not just a string match, so a future edit that re-inlines
// the old (wrong) check is caught immediately.
test("zeroDtePlaysForLargo shares the fresh-find cutoff gate with ZeroDteBoard.tsx (resolveFreshFindStatus)", () => {
  const service = readFileSync(join(ROOT, "lib/platform/zerodte-service.ts"), "utf8");
  assert.match(service, /resolveFreshFindStatus/);
  const boardComponent = readFileSync(join(ROOT, "features/nighthawk/components/ZeroDteBoard.tsx"), "utf8");
  assert.match(boardComponent, /resolveFreshFindStatus/);
});

// ── Hermetic payload tests (mock.module, RELATIVE specifiers — the CI tsx ESM
// loader cannot resolve "@/" aliases inside mock.module/dynamic import) ──────────
//
// Mocks are hoisted to module scope with a mutable `state` driving each test's
// scenario: node:test's mock.module registrations persist for the process, so
// per-test re-registration of the same specifier is not reliable — one mock,
// many scenarios.

type MockLedgerRow = Record<string, unknown>;

function ledgerRow(over: Partial<Record<string, unknown>> = {}): MockLedgerRow {
  return {
    session_date: "2026-07-07",
    ticker: "NVDA",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 140,
    first_flagged_at: new Date().toISOString(),
    entry_premium: 4.2,
    last_mark: 4.62,
    status: "HOLD",
    top_strike: 145,
    conviction: null,
    gross_premium: 2_000_000,
    flow_avg_fill: 4.2,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    plan_json: null,
    underlying_latest: null,
    flags_json: null,
    expiry: null,
    dossier_score: null,
    last_seen_at: new Date().toISOString(),
    close_price: null,
    peak_premium: null,
    trough_premium: null,
    ...over,
  };
}

/** Minimal EnrichedZeroDteSetup stand-in — only the fields the fresh-find lane and
 *  buildIntelNote actually read. */
function freshFind(ticker: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ticker,
    direction: "long",
    top_strike: 100,
    expiry: "2026-07-07",
    score: 75,
    gross_premium: 2_000_000,
    side_dominance: 0.8,
    aggression: 0.6,
    new_money: false,
    spike: false,
    top_strike_avg_fill: 4.2,
    plan: {
      occ: "O:X",
      flow_avg_fill: 4.2,
      bid: 4,
      ask: 4.4,
      mark: 4.2,
      entry_max: 4.2,
      vs_flow_pct: 0,
      entry_status: "IN_RANGE",
      spread_pct: 5,
      illiquid: false,
      stop_premium: 2.1,
      target_premium: 8.4,
      time_stop_et: "15:30",
      underlying_target: null,
      underlying_invalid: null,
    },
    gate: null,
    cortex: null,
    ...over,
  };
}

const state = {
  ledgerRead: { rows: [ledgerRow()] as MockLedgerRow[], committed_known: true },
  setups: [] as Array<Record<string, unknown>>,
};

mock.module("server-only", { namedExports: {} });
mock.module("../bie/ecosystem-context", {
  namedExports: {
    fetchNighthawkEchoForTickers: async () => new Map(),
  },
});
mock.module("../zerodte/scan", {
  namedExports: {
    readZeroDteLedgerChecked: async () => state.ledgerRead,
    readZeroDteLedger: async () => state.ledgerRead.rows,
    syncLedgerLiveState: async (rows: unknown[]) => rows,
    scanZeroDteBoard: async () => ({
      setups: state.setups,
      nighthawk_covered: [],
      upstream_ok: true,
      rejections: [],
      market_state: { confidence: 0, rail_weights: { FLOW: 1, BREAKOUT: 1, PIN: 1 }, regime_structure: null },
    }),
    gradeZeroDteLedger: async () => 0,
  },
});
mock.module("../providers/polygon", { namedExports: { fetchBenzingaNews: async () => [] } });
mock.module("../zerodte/earnings", { namedExports: { readGridEarnings: async () => null } });
mock.module("../server-cache", {
  namedExports: {
    withServerCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    serverCache: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    TTL: { NEWS: 60 },
  },
});
mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-07",
    etNowParts: () => ({ hour: 11, minute: 30 }),
    isTradingDayEt: () => true,
    nextTradingDayEt: () => "2026-07-08",
  },
});
// Always-miss shared cache so getZeroDteBoardPayload cold-builds on EVERY call in these
// state-driven tests — each case must see its own freshly-mutated `state`, never a
// snapshot published by a prior case. (The convergence/liveness/fail-soft behaviour of
// the shared snapshot is covered by zerodte-board-convergence.test.ts.)
mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async () => null,
    sharedCacheSet: async () => {},
    sharedCacheSetNx: async () => true,
    sharedCacheDel: async () => {},
  },
});

test("livePnlPct: board ledger and Largo plays use identical rounding", async () => {
  state.ledgerRead = { rows: [ledgerRow()], committed_known: true };
  state.setups = [];

  const { buildZeroDteBoardPayload, zeroDtePlaysForLargo } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  const largo = (await zeroDtePlaysForLargo()) as { plays: Array<{ live_pnl_pct: number | null }> };

  assert.equal(board.ledger[0]!.live_pnl_pct, 10);
  assert.equal(largo.plays[0]!.live_pnl_pct, board.ledger[0]!.live_pnl_pct);

  // PR-D additive fields: the pane's play-card header reads expiry off the ledger
  // row, and the governor strip reads the payload's own risk summary (real caps,
  // never a client-side copy). The mocked ledger has one HOLD row → one open plan.
  assert.equal(board.ledger[0]!.expiry, null);
  assert.ok(board.governor, "payload carries the governor summary");
  assert.deepEqual(board.governor!.open_plans, [{ ticker: "NVDA", direction: "long" }]);
  assert.equal(board.governor!.halted, false);
  const { GOVERNOR_MAX_CONCURRENT_PLANS } = await import("../zerodte/governor");
  assert.equal(board.governor!.max_concurrent, GOVERNOR_MAX_CONCURRENT_PLANS);
  assert.equal(board.governor!.max_session_stops, 3);
});

// ── P0 one-way commit door (fix/zerodte-status-latch) ─────────────────────────────

test("commit latch: a committed ticker's concurrent fresh find is dropped as a duplicate — never re-told as WATCH/SKIP (both scan orders, case-insensitive)", async () => {
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");

  // The exact regression shape: NVDA committed (OPEN in the ledger) while the next
  // scan build still ranks it as a fresh find whose re-evaluated gate is now
  // BLOCKED (governor cap reached BECAUSE the play committed). The ledger row must
  // be the ONLY presentation of NVDA; the blocked find is a duplicate, dropped.
  const blockedDup = freshFind("nvda", {
    gate: { verdict: "BLOCKED", blocks: [{ code: "governor_max_concurrent", reason: "cap", threshold: null, unlock_et: null }] },
  });
  const other = freshFind("TSLA");

  for (const setups of [
    [blockedDup, other],
    [other, blockedDup],
  ]) {
    state.ledgerRead = { rows: [ledgerRow({ status: "OPEN" })], committed_known: true };
    state.setups = setups;
    const largo = (await zeroDtePlaysForLargo()) as {
      plays: Array<{ ticker: string; status: string }>;
      fresh_finds: Array<{ ticker: string; status: string }>;
    };
    assert.deepEqual(
      largo.plays.map((p) => [p.ticker, p.status]),
      [["NVDA", "OPEN"]],
      "committed play presented from the ledger row, status intact"
    );
    assert.ok(
      !largo.fresh_finds.some((f) => f.ticker.toUpperCase() === "NVDA"),
      "the committed ticker never re-enters the fresh lane"
    );
    assert.deepEqual(largo.fresh_finds.map((f) => f.ticker), ["TSLA"]);
  }
});

test("commit latch: an uncommitted fresh find is WATCH with non-actionable intel — never OPEN/ADD", async () => {
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");
  state.ledgerRead = { rows: [], committed_known: true };
  state.setups = [freshFind("TSLA")];
  const largo = (await zeroDtePlaysForLargo()) as {
    fresh_finds: Array<{ ticker: string; status: string; intel: string }>;
  };
  assert.equal(largo.fresh_finds[0]!.status, "WATCH");
  assert.doesNotMatch(largo.fresh_finds[0]!.intel, /Enter ≤/);
  assert.match(largo.fresh_finds[0]!.intel, /NOT committed/);
});

// ── PR-F tier wiring: pinned tier passthrough + F for refused finds ────────────────

test("tier passthrough: entry_context.tier rides the board ledger row AND the Largo play unchanged (mirror of the cortex passthrough)", async () => {
  const pinnedTier = {
    tier: "B",
    factors: [
      { label: "Prime score band", direction: "up", detail: "Score 78 sits in 75-84 — the best measured band." },
      { label: "Cortex evidence missing", direction: "down", detail: "Cortex abstained — A is out of reach." },
    ],
  };
  state.ledgerRead = {
    rows: [ledgerRow({ entry_context: { tier: pinnedTier, cortex: null } })],
    committed_known: true,
  };
  state.setups = [];

  const { buildZeroDteBoardPayload, zeroDtePlaysForLargo } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.deepEqual(board.ledger[0]!.tier, pinnedTier, "board row carries the pinned blob verbatim");
  const largo = (await zeroDtePlaysForLargo()) as { plays: Array<{ tier: unknown }> };
  assert.deepEqual(largo.plays[0]!.tier, pinnedTier, "Largo play cites the same pinned tier — zero extra IO");
});

test("tier passthrough: a pre-wiring row (no entry_context.tier) serves tier:null — no chip, never a re-derived grade", async () => {
  state.ledgerRead = { rows: [ledgerRow({ entry_context: { cortex: null } })], committed_known: true };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.tier, null);
});

// ── flow_accumulation passthrough (mirror of the cortex/tier passthrough above) ────
// FINDINGS 2026-08-05: the card's AccumulationBadge only ever read the LIVE setup
// match (byTicker.get(ticker) from the current scan), so a committed play's badge
// silently went dark the moment its ticker fell out of the live top-N snapshot —
// even though the entry-time evidence that confirmed the direction never changed.
// This asserts the SAME pinned-blob passthrough tier/cortex already get.

test("flow_accumulation passthrough: entry_context.flow_accumulation rides the board ledger row verbatim, independent of the live setup snapshot", async () => {
  const pinnedAcc = {
    direction: "bull",
    strength: 82,
    days: 3,
    net_signed_premium: 900_000,
    magnet_strike: 450,
    magnet_side: "call",
    aligned: true,
  };
  state.ledgerRead = {
    rows: [ledgerRow({ entry_context: { flow_accumulation: pinnedAcc, cortex: null } })],
    committed_known: true,
  };
  // No live setup for this ticker — proves the read does NOT depend on the byTicker match.
  state.setups = [];

  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.deepEqual(
    board.ledger[0]!.flow_accumulation,
    pinnedAcc,
    "board row carries the pinned accumulation blob verbatim, with no live setup present"
  );
});

test("flow_accumulation passthrough: a row with no multi-day signal at commit serves flow_accumulation:null — never a fabricated read", async () => {
  state.ledgerRead = { rows: [ledgerRow({ entry_context: { cortex: null } })], committed_known: true };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.flow_accumulation, null);
});

// ── Exit-engine visibility (feat/zerodte-exit-engine-visibility) ──────────────────
// The engine's rich exit decision (floor / reason / detail) is now surfaced on the
// ledger row — additive, no computation change. These assert the four new surfaces off
// rows carrying exactly what mapLedgerRow reads: the latched peak + the pinned
// entry_context.exit blob.

test("exit visibility: an OPEN play's latched peak surfaces the live ratchet floor (floor_pnl_pct)", async () => {
  // entry 4.0, peak 6.0 = +50% → the ratchet locks a +20% floor; mark 5.0 = +25% live.
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, peak_premium: 6.0, last_mark: 5.0, trough_premium: 4.0, status: "HOLD" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.floor_pnl_pct, 20, "'your stop is now at +20%' — the guidance the member never saw");
  assert.equal(board.ledger[0]!.closed_reason, null, "a live row is not closed");
  assert.equal(board.ledger[0]!.exit_reason, null, "no engine exit stamped yet");
  assert.equal(board.ledger[0]!.exit_detail, null);
});

test("exit visibility: a live play below the +15% arm has no floor (floor_pnl_pct null)", async () => {
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, peak_premium: 4.5, last_mark: 4.2, trough_premium: 4.0, status: "HOLD" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.floor_pnl_pct, null);
});

test("exit visibility: a pinned ratchet exit surfaces reason + detail and makes closed_reason distinguishable", async () => {
  const exit = {
    reason: "ratchet_breakeven_floor",
    detail: "Mark 4 (+0%) is at/below the +0% floor armed by a +25% peak — the ratchet exits so the green trade cannot finish red.",
    mark: 4.0,
    pnl_pct: 0,
    peak_pnl_pct: 25,
    at: "2026-07-07T15:00:00.000Z",
  };
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, last_mark: 4.0, peak_premium: 5.0, trough_premium: null, status: "CLOSED", entry_context: { exit } })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.exit_reason, "ratchet");
  assert.equal(board.ledger[0]!.exit_detail, exit.detail);
  assert.equal(board.ledger[0]!.closed_reason, "ratchet", "a ratchet exit is no longer indistinguishable from a target trim (both were null)");
});

test("exit visibility: a target-trim exit is categorized 'target' — distinct from a ratchet exit", async () => {
  const exit = { reason: "plan_target_final", detail: "runner banked in full.", mark: 8.2, pnl_pct: 105, peak_pnl_pct: 112, at: "2026-07-07T15:00:00.000Z" };
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, last_mark: 8.2, peak_premium: 9.0, trough_premium: 4.0, status: "CLOSED", entry_context: { exit } })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.exit_reason, "target");
  assert.equal(board.ledger[0]!.closed_reason, "target");
});

test("exit visibility: a stopped play with no trim tranches armed still pins P&L to −50", async () => {
  // entry 4.0, stop 2.0; trough 1.8 ≤ stop and the peak never tagged the +100% target.
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, last_mark: 1.9, peak_premium: 4.4, trough_premium: 1.8, status: "CLOSED" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.closed_reason, "stopped");
  assert.equal(board.ledger[0]!.live_pnl_pct, -50, "peak +10% never armed trim tranches");
  assert.equal(board.ledger[0]!.peak_pnl_pct, 10);
});

/** The META-class row: peaked +87% (arming both trim tranches), then stopped at −50%. */
function metaStoppedRunner(entryContext: Record<string, unknown> | null) {
  return ledgerRow({
    ticker: "META",
    entry_premium: 3.15,
    last_mark: 1.57,
    peak_premium: 5.9,
    trough_premium: 1.57,
    status: "CLOSED",
    entry_context: entryContext,
  });
}

test("exit visibility: a TRIM_SCALE-committed META-class stopped runner returns the trim-scale blend", async () => {
  state.ledgerRead = {
    rows: [metaStoppedRunner({ exit_policy_at_commit: "trim_scale" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.closed_reason, "stopped");
  assert.equal(board.ledger[0]!.peak_pnl_pct, 87.3);
  assert.equal(board.ledger[0]!.exit_policy_at_commit, "trim_scale");
  assert.equal(board.ledger[0]!.live_pnl_pct, 6.67, "⅓@+20 + ⅓@+50 + ⅓@(−50) runner");
});

test("REGRESSION: the SAME stopped runner committed under RATCHET reports the real −50%, not +6.67%", async () => {
  // A ratchet row banks nothing on the way up, so crediting it two trim tranches invents exits the
  // member was never guided to take — and turns a play that lost half its premium into a WINNER on
  // the board. Identical premiums to the test above; only the committed policy differs.
  state.ledgerRead = {
    rows: [metaStoppedRunner({ exit_policy_at_commit: "ratchet" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.closed_reason, "stopped");
  assert.equal(board.ledger[0]!.peak_pnl_pct, 87.3, "the peak excursion is unchanged — it really did run +87%");
  assert.equal(board.ledger[0]!.exit_policy_at_commit, "ratchet");
  assert.equal(board.ledger[0]!.live_pnl_pct, -50, "a ratchet runner that stopped lost 50%");
});

test("REGRESSION: a legacy stopped runner with NO committed policy pins to the stop rather than guessing", async () => {
  state.ledgerRead = { rows: [metaStoppedRunner(null)], committed_known: true };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.exit_policy_at_commit, null);
  assert.equal(board.ledger[0]!.live_pnl_pct, -50, "understating a stopped play is the safe error");
});

test("exit visibility: a plain 15:30 close with no engine exit reads closed_reason 'time_stop'", async () => {
  state.ledgerRead = {
    rows: [ledgerRow({ entry_premium: 4.0, last_mark: 4.1, peak_premium: 4.5, trough_premium: 3.5, status: "CLOSED" })],
    committed_known: true,
  };
  state.setups = [];
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  const board = await buildZeroDteBoardPayload();
  assert.equal(board.ledger[0]!.closed_reason, "time_stop");
  assert.equal(board.ledger[0]!.exit_reason, null);
});

test("fresh-lane tiers: a refused (SKIP) find carries tierForSkip's F with each block as a down factor; a WATCH candidate carries NO tier", async () => {
  state.ledgerRead = { rows: [], committed_known: true };
  state.setups = [
    freshFind("TSLA"), // clean RTH find → WATCH (not a decision — must get no tier)
    freshFind("META", {
      gate: {
        verdict: "BLOCKED",
        blocks: [{ code: "score_floor", reason: "Score 62 is under the 65 floor.", threshold: 65, unlock_et: null }],
      },
    }),
  ];
  const { zeroDtePlaysForLargo } = await import("./zerodte-service");
  const largo = (await zeroDtePlaysForLargo()) as {
    fresh_finds: Array<{ ticker: string; status: string; tier: { tier: string; factors: Array<Record<string, unknown>> } | null }>;
  };
  const meta = largo.fresh_finds.find((f) => f.ticker === "META")!;
  assert.equal(meta.status, "SKIP");
  assert.equal(meta.tier!.tier, "F");
  assert.deepEqual(meta.tier!.factors, [
    { label: "score_floor", direction: "down", detail: "Score 62 is under the 65 floor." },
  ]);
  const tsla = largo.fresh_finds.find((f) => f.ticker === "TSLA")!;
  assert.equal(tsla.status, "WATCH");
  assert.equal(tsla.tier, null, "an uncommitted, unrefused candidate is not a decision — no invented grade");
});

test("commit latch: unknowable committed set (ledger read failed, no same-session snapshot) fails CLOSED — no fresh finds render, upstream degraded", async () => {
  const { buildZeroDteBoardPayload } = await import("./zerodte-service");
  // WHY: with the committed set unreadable, a committed play's ticker (which
  // usually still ranks in the scan) would render as an uncommitted find — the
  // member's OPEN card demoted to a watch card. Same fail-closed rule
  // persistZeroDteScan applies to commits, applied to display.
  state.ledgerRead = { rows: [], committed_known: false };
  state.setups = [freshFind("NVDA"), freshFind("TSLA")];
  const board = await buildZeroDteBoardPayload();
  assert.deepEqual(board.setups, [], "no fresh find may render when fresh-vs-committed is unknowable");
  assert.equal(board.upstream_ok, false, "the freshness badge must say degraded, not impersonate a live empty board");
});

// Terminal v2 — assert mapLedgerRow emits the additive terminal fields (the source of the
// RTH-real render), resolved from the row's OWN frozen policy/live-marks store, not fabricated.
test("mapLedgerRow emits the Terminal v2 additive fields (exit ladder, greeks, book, executable, origin)", () => {
  const service = readFileSync(join(ROOT, "lib/platform/zerodte-service.ts"), "utf8");
  // The real ladder is resolved from the FROZEN exit policy (never current code), then priced/fired.
  assert.match(service, /resolveExitLadder/);
  assert.match(service, /readFrozenExitPolicy/);
  assert.match(service, /buildTerminalExitLadder/);
  // Live greeks + two-sided book flow from the SAME live-marks store entry behind last_mark.
  assert.match(service, /greeks: liveMark\?\.greeks/);
  assert.match(service, /bid: liveMark\?\.bid/);
  // Executable P&L is the sell-into-the-bid number.
  assert.match(service, /live_pnl_pct_exec: executableFill/);
  // Discovery origin comes from the frozen origin maps.
  assert.match(service, /discovery_origin: readDiscoveryOrigins/);
  // OCC on the ledger row so the Command Deck can key the ~1s marks overlay for ledger-only plays.
  assert.match(service, /occ: typeof r\.plan_json\?\.occ === "string"/);
});
