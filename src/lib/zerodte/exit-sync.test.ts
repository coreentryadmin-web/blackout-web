// B-8 sync-path integration: the exit engine wired through the REAL
// syncLedgerLiveState (scan.ts), with the same wholesale hermetic-mock idiom
// scan.test.ts uses for the exact same module graph (see its header for the WHY per
// mock). Separate file on purpose: node --test runs each file in its own process,
// so these mocks/fixtures can't leak into scan.test.ts (ESM module cache).
//
// What this file proves that exit-engine.test.ts (pure tables) cannot:
//  - a ratchet-floor breach observed by the sync snapshot CLOSES the row (persisted
//    status + frozen last_mark = the exit mark) and stamps entry_context.exit;
//  - the FRESHEST mark wins: a fresh live-marks-lane mark exits a play the sync
//    snapshot alone would have kept open (and the frozen mark is the lane's);
//  - a stale lane mark is refused (staleness rule) — the sync mark decides;
//  - thesis break closes through the same path with the evidence reason;
//  - Cortex outage is fail-soft: evidence unavailable → no thesis exit, the row
//    stays live, and nothing else about the sync changes;
//  - a healthy row passes through the engine untouched.
//
// TIMING DISCIPLINE (same as zerodte-service-marks.test.ts): the lane-mark freshness
// check runs against the real clock inside exit-sync, so the fresh-direction seed is
// future-dated (+30s) and the stale direction uses a far-past asOf — both sides stay
// deterministic under CI scheduler stalls. All imports happen before any seeding.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { EvidenceItem } from "@/lib/nighthawk/cortex/types";

type LedgerRow = Record<string, unknown>;

const state = {
  ledgerRows: [] as LedgerRow[],
  /** Snapshot mark served per OCC by the mocked unified-snapshot fetch. */
  snapMark: null as number | null,
  updateCalls: [] as Array<{ session_date: string; ticker: string; patch: { status: string; mark: number | null } }>,
  stampCalls: [] as Array<{ session_date: string; ticker: string; exit: Record<string, unknown> }>,
  /** Evidence the mocked Cortex compose returns; null → fetch throws (outage). */
  verdictItems: null as EvidenceItem[] | null,
};

function resetState() {
  state.ledgerRows = [];
  state.snapMark = null;
  state.updateCalls = [];
  state.stampCalls = [];
  state.verdictItems = null;
}

mock.module("server-only", { namedExports: {} });

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLog: async () => state.ledgerRows,
    updateZeroDteLiveState: async (session_date: string, ticker: string, patch: { status: string; mark: number | null }) => {
      state.updateCalls.push({ session_date, ticker, patch });
    },
    stampZeroDteExitContext: async (session_date: string, ticker: string, exit: Record<string, unknown>) => {
      state.stampCalls.push({ session_date, ticker, exit });
    },
    // Module-scope imports scan.ts needs resolvable (same list as scan.test.ts).
    fetchLatestNighthawkEdition: async () => null,
    fetchOpenSpxPlay: async () => null,
    fetchRecentFlows: async () => [],
    fetchUngradedZeroDteRows: async () => [],
    gradeZeroDteSetupRow: async () => {},
    insertAlertAuditLog: async () => {},
    updateZeroDtePlanOutcome: async () => {},
    upsertZeroDteSetupLog: async () => new Set<string>(),
  },
});

// The exit engine's evidence read: fetchCortexInputs → composeCortexEvidence. The
// fetch mock throws on demand (total-outage direction); the compose mock returns a
// state-controlled verdict. Compose's OTHER exports must exist because the cortex
// barrel re-exports them by name (ESM linking checks every one).
mock.module("../nighthawk/cortex/fetch", {
  namedExports: {
    fetchCortexInputs: async () => {
      if (state.verdictItems == null) throw new Error("hermetic: cortex outage");
      return {};
    },
    CORTEX_SOURCE_TIMEOUT_MS: 2_500,
  },
});
mock.module("../nighthawk/cortex/compose", {
  namedExports: {
    composeCortexEvidence: () => {
      const items = state.verdictItems ?? [];
      return {
        ticker: "X",
        direction: "long",
        asOf: new Date().toISOString(),
        vetoes: items.filter((i) => i.stance === "veto"),
        supports: items.filter((i) => i.stance === "supports"),
        opposes: items.filter((i) => i.stance === "opposes"),
        score: 0,
        absent: [],
        conviction: "C",
        narrative: [],
      };
    },
    cortexDecayFactor: () => 1,
    ABSENT_AFTER_HALF_LIVES: 3,
    CONVICTION_A_MIN_SCORE: 3,
    CONVICTION_B_MIN_SCORE: 1.5,
    SOURCE_SUPPORT_CAPS: {},
  },
});

mock.module("../bie/ecosystem-context", {
  namedExports: { fetchNighthawkEchoForTickers: async () => new Map() },
});
mock.module("../../features/nighthawk/lib/dossier", {
  namedExports: { createDossierBuildCache: () => ({}), fetchTickerDossier: async () => null },
});
mock.module("../../features/nighthawk/lib/session", {
  namedExports: {
    todayEt: () => "2026-07-14",
    etNowParts: () => ({ hour: 11, minute: 30 }),
    isTradingDayEt: () => true,
    formatEtDate: (d: Date) => d.toISOString().slice(0, 10),
  },
});
mock.module("../providers/polygon-largo", {
  namedExports: { fetchAggBars: async () => [] },
});
mock.module("../providers/options-snapshot", {
  namedExports: {
    fetchOptionsUnifiedSnapshot: async (occs: string[]) => {
      const map = new Map<string, { mark: number | null; bid: number | null; ask: number | null; underlyingPrice: number | null }>();
      for (const occ of occs) {
        if (state.snapMark != null) {
          map.set(occ, { mark: state.snapMark, bid: state.snapMark, ask: state.snapMark, underlyingPrice: null });
        }
      }
      return map;
    },
  },
});
mock.module("../ws/options-socket", {
  namedExports: {
    buildOcc: () => null,
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
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-14" },
});
mock.module("../platform/zerodte-service", {
  namedExports: { zeroDtePlaysForLargo: async () => ({}) },
});

// Lazy imports (no top-level await under the local CJS transform — scan.test.ts's
// `mod()` idiom): each test loads both graphs BEFORE any clock-sensitive seeding.
// The lane store is seeded through the SAME specifier exit-sync resolves
// ("./live-marks"), so the test writes to the module instance the engine reads.
const mods = async () => {
  const lane = await import("./live-marks");
  const { syncLedgerLiveState } = await import("./scan");
  return { lane, syncLedgerLiveState };
};

const OCC = "O:NVDA260714C00180000";

function baseRow(overrides: LedgerRow = {}): LedgerRow {
  return {
    session_date: "2026-07-14",
    ticker: "NVDA",
    direction: "long",
    score: 80,
    score_max: 80,
    spike: false,
    underlying_at_flag: 178,
    // 10 minutes old vs the REAL clock (the engine ages rows off first_flagged_at):
    // young enough that flat-timeout can never fire unless a test says so.
    first_flagged_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    entry_premium: 4.0,
    last_mark: 4.0,
    status: "OPEN",
    top_strike: 180,
    conviction: null,
    gross_premium: 2_000_000,
    flow_avg_fill: 4.0,
    move_pct: null,
    direction_hit: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    graded_at: null,
    plan_json: { occ: OCC, stop_premium: 2.0, target_premium: 8.0 },
    underlying_latest: null,
    flags_json: null,
    expiry: "2026-07-14",
    dossier_score: null,
    close_price: null,
    peak_premium: 4.0,
    trough_premium: 4.0,
    entry_context: null,
    gate_calibration_json: null,
    ...overrides,
  };
}

const laneMark = (mark: number, asOf: number) => ({
  occ: OCC,
  bid: mark,
  ask: mark,
  mid: mark,
  last: mark,
  mark,
  source: "mid" as const,
  asOf,
  lane: "rest" as const,
});

test("ratchet floor breach via the sync mark: row CLOSES at the exit mark and entry_context.exit is stamped", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  // Peaked +30% (5.2) earlier; the snapshot now shows 3.98 (−0.5%) — at/below the
  // breakeven floor the +25% peak armed. Pre-engine this row stayed live all the
  // way down to the −50% stop: the exact green-turned-red class.
  // Freeze exit_policy_at_commit to "ratchet" so this test exercises the ratchet
  // path explicitly (DEFAULT_EXIT_MODE is now trim_scale).
  state.ledgerRows = [baseRow({ peak_premium: 5.2, entry_context: { exit_policy_at_commit: "ratchet" } })];
  state.snapMark = 3.98;

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 4.0, "breakeven floor honored — exit at entry, not the gapped-through mark");
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0]!.patch, { status: "CLOSED", mark: 4.0 });
  assert.equal(state.stampCalls.length, 1, "the counterfactual exit record must persist");
  const exit = state.stampCalls[0]!.exit as { reason: string; mark: number; pnl_pct: number; peak_pnl_pct: number };
  assert.equal(exit.reason, "ratchet_breakeven_floor");
  assert.equal(exit.mark, 4.0);
  assert.equal(exit.pnl_pct, 0);
  assert.equal(exit.peak_pnl_pct, 30);
});

test("freshest mark wins: a FRESH lane mark below the floor exits even when the sync snapshot is still above it", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 5.2, entry_context: { exit_policy_at_commit: "ratchet" } })];
  state.snapMark = 4.5; // +12.5% — above the breakeven floor, sync alone would hold
  // Future-dated (+30s) so the real-clock freshness check can never flake (header).
  lane.putZeroDteLiveMark(laneMark(3.9, Date.now() + 30_000));

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 4.0, "floor honored even when lane mark gapped below breakeven");
  assert.equal((state.stampCalls[0]!.exit as { reason: string }).reason, "ratchet_breakeven_floor");
  lane._resetZeroDteLiveMarksForTest();
});

test("staleness honesty: a STALE lane mark is refused — the sync mark decides and the row stays live", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 5.2 })];
  state.snapMark = 4.5; // above the floor
  lane.putZeroDteLiveMark(laneMark(3.9, Date.now() - 60_000)); // 60s old — stale

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED", "a stale lane mark must never trigger an exit");
  assert.equal(state.stampCalls.length, 0);
  lane._resetZeroDteLiveMarksForTest();
});

test("thesis break closes through the same path — at a loss, with the evidence reason stamped", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 4.1 })];
  state.snapMark = 3.4; // −15%: no floor armed, above the plan stop — only the thesis fires
  state.verdictItems = [
    {
      source: "wall-trend",
      stance: "veto",
      weight: 2,
      halfLifeSec: 600,
      asOf: new Date().toISOString(),
      detail: "opposing wall building through the strike",
    },
  ] as EvidenceItem[];

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 3.4);
  const exit = state.stampCalls[0]!.exit as { reason: string; pnl_pct: number };
  assert.equal(exit.reason, "thesis_break:wall-trend");
  assert.equal(exit.pnl_pct, -15, "a broken thesis exits at market even red");
});

test("fail-soft: Cortex outage → no thesis exit, the row stays live, sync otherwise unchanged", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [baseRow({ peak_premium: 4.1 })];
  state.snapMark = 3.4; // same −15% tick as above…
  state.verdictItems = null; // …but the evidence read throws (outage)

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED", "missing evidence must NEVER exit a play");
  assert.equal(state.stampCalls.length, 0);
  assert.equal(state.updateCalls.length, 1, "the normal live-state persist still runs");
  assert.equal(state.updateCalls[0]!.patch.mark, 3.4);
});

test("flat timeout through the sync path: a 26-minute ±10% sleeper is scratched", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.verdictItems = []; // Cortex sees, and sees nothing wrong — only the clock fires
  state.ledgerRows = [baseRow({ first_flagged_at: new Date(Date.now() - 26 * 60_000).toISOString() })];
  state.snapMark = 4.05; // +1.25%, never left the band (peak 4.05)

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  assert.equal((state.stampCalls[0]!.exit as { reason: string }).reason, "flat_theta_bleed");
});

test("healthy green row passes the engine untouched (no exit, no stamp)", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.verdictItems = [];
  state.ledgerRows = [baseRow({ peak_premium: 4.4 })]; // peak +10% — below the arm threshold
  state.snapMark = 4.3;

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(rows[0]!.status, "CLOSED");
  assert.equal(rows[0]!.last_mark, 4.3);
  assert.equal(state.stampCalls.length, 0);
});

// ── Q13: frozen exit archetype ──────────────────────────────────────────────────────
// readFrozenExitMode is the pure reader evaluateLedgerRowExit consults BEFORE the live
// env, so an open play exits under its commit-time policy. (Loaded via dynamic import so
// the module's server-only deps resolve through the mocks registered above.)
test("readFrozenExitMode: reads a valid pinned mode; null for missing/invalid (legacy → env fallback)", async () => {
  const { readFrozenExitMode } = await import("./exit-sync");
  assert.equal(readFrozenExitMode({ exit_policy_at_commit: "trim_scale" }), "trim_scale");
  assert.equal(readFrozenExitMode({ exit_policy_at_commit: "ratchet" }), "ratchet");
  // Anything not a known mode → null, so evaluateLedgerRowExit falls back to resolveExitMode()
  // exactly as a pre-Q13 row did — never a fabricated mode.
  assert.equal(readFrozenExitMode({ exit_policy_at_commit: "bogus" }), null);
  assert.equal(readFrozenExitMode({}), null);
  assert.equal(readFrozenExitMode(null), null);
  assert.equal(readFrozenExitMode(undefined), null);
});

// ── resolveExitMode: the operator's env switch (DEFAULT-OFF) — SECOND-WAVE coverage ──
// resolveExitMode reads ZERODTE_EXIT_MODE and is the fallback evaluateLedgerRowExit uses
// for legacy/unpinned rows. Env is passed in (injectable), so no process.env mutation.
test("resolveExitMode: trim_scale is the default; only exact 'trim_scale' env opts in explicitly", async () => {
  const { resolveExitMode } = await import("./exit-sync");
  const { DEFAULT_EXIT_MODE } = await import("./exit-engine");
  assert.equal(DEFAULT_EXIT_MODE, "trim_scale", "the default is trim_scale");
  // Explicit trim_scale env.
  assert.equal(resolveExitMode({ ZERODTE_EXIT_MODE: "trim_scale" } as NodeJS.ProcessEnv), "trim_scale");
  // Unset / empty / explicit ratchet / any other token → DEFAULT (trim_scale).
  assert.equal(resolveExitMode({} as NodeJS.ProcessEnv), "trim_scale");
  assert.equal(resolveExitMode({ ZERODTE_EXIT_MODE: "" } as NodeJS.ProcessEnv), "trim_scale");
  assert.equal(resolveExitMode({ ZERODTE_EXIT_MODE: "ratchet" } as NodeJS.ProcessEnv), "trim_scale");
  assert.equal(resolveExitMode({ ZERODTE_EXIT_MODE: "TRIM_SCALE" } as NodeJS.ProcessEnv), "trim_scale", "exact match only — no casing tolerance");
  assert.equal(resolveExitMode({ ZERODTE_EXIT_MODE: "trim" } as NodeJS.ProcessEnv), "trim_scale");
});

// ── resolveTrimRegimeLive: the regime-conditioning kill-switch (DEFAULT-OFF) — FINDING
//    2026-08-29. Off by default because trend/range tranche thresholds are uncalibrated
//    v1 heuristics (only `neutral` is E5-measured) — flipping this on lets the live engine
//    condition real trims on the row's stamped session_regime; unset/anything-but-exact-"1"
//    must stay off so a typo'd env value can never silently change live exit behavior.
test("resolveTrimRegimeLive: off by default — only the exact string '1' opts in", async () => {
  const { resolveTrimRegimeLive } = await import("./exit-sync");
  assert.equal(resolveTrimRegimeLive({} as NodeJS.ProcessEnv), false);
  assert.equal(resolveTrimRegimeLive({ ZERODTE_TRIM_REGIME_LIVE: "" } as NodeJS.ProcessEnv), false);
  assert.equal(resolveTrimRegimeLive({ ZERODTE_TRIM_REGIME_LIVE: "true" } as NodeJS.ProcessEnv), false);
  assert.equal(resolveTrimRegimeLive({ ZERODTE_TRIM_REGIME_LIVE: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(resolveTrimRegimeLive({ ZERODTE_TRIM_REGIME_LIVE: "1" } as NodeJS.ProcessEnv), true);
});

// ── ENTRY-BASIS COHERENCE: the operative stop can never be looser than −50% of the
//    LEDGER basis, no matter how far the mark ran past the flow fill before commit ───
//
// The pinned plan_json.stop_premium is entry_max×0.5 where entry_max = flow_avg_fill
// (plan.ts:271); the ledger entry_premium is that value FLOORED UP to the flag-time mark
// (resolveLedgerEntryPremium). G-8/G-9 permit mark up to +54.99% over the fill before
// `MOVED` blocks (CHASE_PCT=55), so the pinned stop can sit far below −50% of the basis
// the engine measures P&L against. Measured LIVE on the prod board 2026-08-06: 8 of 24
// candidate setups had mark > entry_max; AVGO (+35.26% vs flow) implied a −62.92%
// operative stop. This is the ONLY reachable path by which any exit reason can be
// stamped worse than the −50% hard stop.

test("entry-basis coherence: a ledger basis above entry_max re-bases the stop — worst case is −50%, not −67%", async () => {
  const { lane, syncLedgerLiveState } = await mods();

  // CHASE_PCT boundary: flow filled at 4.02, the mark had already run to 6.20 (+54.23%,
  // still IN_RANGE — MOVED blocks at +55%). Ledger basis = 6.20; the pinned stop of 2.01
  // is −67.58% of it. The ledger-basis stop is 6.20 × 0.5 = 3.10.
  const entryMax = 4.02;
  const ledgerEntry = 6.2;
  const pinnedStop = 2.01; // = entryMax × 0.5 — the stale-basis rail

  const cases: Array<{ mark: number; close: boolean; why: string }> = [
    // −45% of the ledger basis and comfortably above the pinned stop: nothing fires.
    { mark: 3.41, close: false, why: "-45% of the basis is inside the hard stop" },
    // EXACTLY the −50% ledger stop. Pre-fix the operative stop was 2.01, so this tick
    // was walked straight past and the row stayed open into a deeper loss.
    { mark: 3.1, close: true, why: "-50% of the basis IS the hard stop" },
    // −59.7%: still ABOVE the stale pinned stop of 2.01, so pre-fix this did not stop
    // either — this is the reachable "stamped worse than −50%" tick.
    { mark: 2.5, close: true, why: "-59.7% is past the hard stop but above the stale pinned stop" },
  ];

  for (const c of cases) {
    resetState();
    lane._resetZeroDteLiveMarksForTest();
    state.ledgerRows = [
      baseRow({
        entry_premium: ledgerEntry,
        flow_avg_fill: entryMax,
        peak_premium: ledgerEntry, // never green — no ratchet floor can arm
        trough_premium: ledgerEntry,
        last_mark: ledgerEntry,
        entry_context: { exit_policy_at_commit: "ratchet" },
        plan_json: { occ: OCC, entry_max: entryMax, stop_premium: pinnedStop, target_premium: 8.0 },
      }),
    ];
    state.snapMark = c.mark;

    const rows = await syncLedgerLiveState(state.ledgerRows as never);

    if (c.close) {
      assert.equal(rows[0]!.status, "CLOSED", `mark ${c.mark}: ${c.why}`);
      assert.equal((state.stampCalls[0]!.exit as { reason: string }).reason, "plan_stop", `mark ${c.mark}`);
    } else {
      assert.notEqual(rows[0]!.status, "CLOSED", `mark ${c.mark}: ${c.why}`);
    }
    lane._resetZeroDteLiveMarksForTest();
  }

  // And the headline bound: a tick AT the ledger-basis stop books exactly −50%, never −67.58%.
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [
    baseRow({
      entry_premium: ledgerEntry,
      flow_avg_fill: entryMax,
      peak_premium: ledgerEntry,
      trough_premium: ledgerEntry,
      last_mark: ledgerEntry,
      entry_context: { exit_policy_at_commit: "ratchet" },
      plan_json: { occ: OCC, entry_max: entryMax, stop_premium: pinnedStop, target_premium: 8.0 },
    }),
  ];
  state.snapMark = ledgerEntry * 0.5;
  await syncLedgerLiveState(state.ledgerRows as never);
  assert.equal((state.stampCalls[0]!.exit as { pnl_pct: number }).pnl_pct, -50);
  lane._resetZeroDteLiveMarksForTest();
});

// ── ACHIEVABILITY CEILING (2026-08-27, plan.ts PR #2986) is the SYMMETRIC counterpart of the
//    FLOOR case above: resolveLedgerEntryPremium can also move the ledger basis DOWN, capping a
//    flow fill that sat far above a live market that never traded there. `entryBasisDiverged`
//    was written for the floor direction only (`entry > planEntryMax`) and never updated when the
//    ceiling shipped, so a ceiling-capped row kept using the STALE pinned stop — which, being
//    entry_max×0.5 off the OLD (much higher) entry_max, sits ABOVE the new (lower) ledger entry.
//    Reproduces the live production defect measured 2026-08-28: AMD flow fill $3.80, ledger-
//    capped entry $1.23 (real market never near $3.80), pinned stop 1.90 — every mark from that
//    point on reads "at/below 1.90" trivially, so the row closed_reason="stop" within ~1s of its
//    own commit at ~0% real P&L. Two such phantom stops (AMD, NVDA) contributed to the session's
//    stop tally and the desk halting for the rest of the day.
test("entry-basis coherence: a ledger basis BELOW entry_max (achievability ceiling) also re-bases the stop — no instant phantom stop", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();

  const entryMax = 3.82; // the flow's own fill — the market never actually traded this high
  const ledgerEntry = 1.24; // resolveLedgerEntryPremium capped DOWN to the flag-time mark
  const pinnedStop = 1.91; // = entryMax × 0.5 — stale once the ceiling capped the basis down

  state.ledgerRows = [
    baseRow({
      entry_premium: ledgerEntry,
      flow_avg_fill: entryMax,
      peak_premium: ledgerEntry,
      trough_premium: ledgerEntry,
      last_mark: ledgerEntry,
      entry_context: { exit_policy_at_commit: "ratchet" },
      plan_json: { occ: OCC, entry_max: entryMax, stop_premium: pinnedStop, target_premium: 7.6 },
    }),
  ];
  // The live AMD tick: barely below the STALE pinned stop (1.91) but nowhere near the real
  // −50% ledger stop (1.24 × 0.5 = 0.62). Pre-fix this closed instantly; post-fix it must hold.
  state.snapMark = 1.225;

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.notEqual(
    rows[0]!.status,
    "CLOSED",
    "a mark of 1.225 is far above the real ledger-basis stop of 0.62 — must not phantom-stop off the stale pre-ceiling pinned stop of 1.91"
  );

  // And the correct ledger-basis stop DOES still fire, once the mark actually gets there.
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [
    baseRow({
      entry_premium: ledgerEntry,
      flow_avg_fill: entryMax,
      peak_premium: ledgerEntry,
      trough_premium: ledgerEntry,
      last_mark: ledgerEntry,
      entry_context: { exit_policy_at_commit: "ratchet" },
      plan_json: { occ: OCC, entry_max: entryMax, stop_premium: pinnedStop, target_premium: 7.6 },
    }),
  ];
  state.snapMark = ledgerEntry * 0.5; // exactly the re-derived ledger-basis stop
  const stoppedRows = await syncLedgerLiveState(state.ledgerRows as never);
  assert.equal(stoppedRows[0]!.status, "CLOSED");
  assert.equal((state.stampCalls[0]!.exit as { reason: string; pnl_pct: number }).reason, "plan_stop");
  assert.equal((state.stampCalls[0]!.exit as { reason: string; pnl_pct: number }).pnl_pct, -50);
  lane._resetZeroDteLiveMarksForTest();
});

test("entry-basis coherence: when the bases AGREE the pinned rails are used byte-identically", async () => {
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  // entry_premium === entry_max (the mark never ran past the flow fill) — the overwhelming
  // majority of live rows. The pinned stop must still be the operative one, unchanged.
  state.ledgerRows = [
    baseRow({
      entry_premium: 4.0,
      peak_premium: 4.0,
      entry_context: { exit_policy_at_commit: "ratchet" },
      plan_json: { occ: OCC, entry_max: 4.0, stop_premium: 2.0, target_premium: 8.0 },
    }),
  ];
  state.snapMark = 2.0; // exactly the pinned stop

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  const exit = state.stampCalls[0]!.exit as { reason: string; pnl_pct: number };
  assert.equal(exit.reason, "plan_stop");
  assert.equal(exit.pnl_pct, -50);
  lane._resetZeroDteLiveMarksForTest();
});

test("entry-basis coherence: below the −50% ledger stop the PROTECTIVE rule preempts thesis break", async () => {
  // THE ACTUAL REACHABLE HARM. Both live callers run the engine FIRST with
  // `deferPlanStop: true` (scan.ts:1664-1676, live-marks.ts:533-535) and, when the engine
  // returns an EXIT, the derivePlayStatus latch is bypassed entirely. So a thesis_break /
  // flat_timeout — both of which fire at ANY P&L — used to be reached at marks the
  // protective rule should already have owned, because the protective check compared
  // against a stop on the stale entry_max basis. That is the only path by which an exit
  // reason other than plan_stop could be stamped worse than the −50% hard stop.
  const { lane, syncLedgerLiveState } = await mods();
  resetState();
  lane._resetZeroDteLiveMarksForTest();
  state.ledgerRows = [
    baseRow({
      entry_premium: 6.2, // ledger basis (mark at flag) — hard stop 3.10
      flow_avg_fill: 4.02,
      peak_premium: 6.2, // never green
      trough_premium: 6.2,
      last_mark: 6.2,
      entry_context: { exit_policy_at_commit: "ratchet" },
      plan_json: { occ: OCC, entry_max: 4.02, stop_premium: 2.01, target_premium: 8.04 },
    }),
  ];
  state.snapMark = 2.9; // −53.2% of the basis: past the hard stop, above the stale 2.01 rail
  state.verdictItems = [
    {
      source: "wall-trend",
      stance: "veto",
      weight: 2,
      halfLifeSec: 600,
      asOf: new Date().toISOString(),
      detail: "opposing wall building through the strike",
    },
  ] as EvidenceItem[];

  const rows = await syncLedgerLiveState(state.ledgerRows as never);

  assert.equal(rows[0]!.status, "CLOSED");
  const exit = state.stampCalls[0]!.exit as { reason: string };
  assert.equal(
    exit.reason,
    "plan_stop",
    "a mark past the −50% ledger stop must exit PROTECTIVE, not thesis_break — the stop owns this tick"
  );
  lane._resetZeroDteLiveMarksForTest();
});
