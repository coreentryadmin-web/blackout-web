import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = {
  dbConfigured: true,
  cursor: null as string | null,
  inserted: [] as Array<Record<string, unknown>>,
};

// REGRESSION (zerodte-discovery-rejection-cursor-race): simulates a real Postgres
// session-level advisory lock — non-blocking "try" semantics, held by at most one caller at a
// time — the same fake shape x-rate-budget-concurrency.test.ts uses for recordBudgetUse's
// identical read-modify-write race.
let lockHolder: symbol | null = null;

function resetState() {
  state.dbConfigured = true;
  state.cursor = null;
  state.inserted = [];
  lockHolder = null;
}

mock.module("../db", {
  namedExports: {
    dbConfigured: () => state.dbConfigured,
    getMeta: async (key: string) => {
      const value = key === "zerodte_discovery_event_cursor" ? state.cursor : null;
      // Force a real async gap so two concurrent calls both read the cursor BEFORE either
      // writes — the exact interleaving that produces a lost update when unlocked.
      await new Promise((r) => setTimeout(r, 5));
      return value;
    },
    setMeta: async (key: string, value: string) => {
      if (key === "zerodte_discovery_event_cursor") state.cursor = value;
    },
    insertZeroDteDiscoveryEvent: async (row: Record<string, unknown>) => {
      state.inserted.push(row);
    },
    tryAdvisoryLock: async (_lockKey: string): Promise<boolean> => {
      if (lockHolder !== null) return false;
      lockHolder = Symbol();
      return true;
    },
    releaseAdvisoryLock: async (_lockKey: string): Promise<void> => {
      lockHolder = null;
    },
  },
});
mock.module("../providers/spx-session", {
  namedExports: { todayEtYmd: () => "2026-07-06" },
});

const mod = () => import("./discovery-events-persist");

test("persistDiscoveryDetectedEvents: throttles duplicate score bucket per ticker", async () => {
  resetState();
  const { persistDiscoveryDetectedEvents } = await mod();
  const setup = {
    ticker: "NVDA",
    score: 72,
    discovery_origin: ["FLOW"],
    contract_horizon: "ZERO_DTE",
    direction: "long",
    play_type: "DIRECTIONAL",
    gate: { verdict: "COMMIT" },
  } as import("./board").EnrichedZeroDteSetup;

  assert.equal(await persistDiscoveryDetectedEvents([setup], null), 1);
  assert.equal(await persistDiscoveryDetectedEvents([setup], null), 0);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.inserted[0]!.kind, "detected");
});

test("persistDiscoveryGateBlockedEvents: gate_blocked throttle", async () => {
  resetState();
  const { persistDiscoveryGateBlockedEvents } = await mod();
  const rej = {
    ticker: "AMD",
    gate_failed: "min_gross",
    direction: "long",
    reason: "below floor",
    gross_premium: 50_000,
    threshold: 200_000,
  } as import("./board").ZeroDteGateRejection;

  assert.equal(await persistDiscoveryGateBlockedEvents([rej]), 1);
  assert.equal(await persistDiscoveryGateBlockedEvents([rej]), 0);
  assert.equal(state.inserted[0]!.kind, "gate_blocked");
});

test("persistDiscoveryCommitEvents: one commit row per ticker per session", async () => {
  resetState();
  const { persistDiscoveryCommitEvents } = await mod();
  const setup = {
    ticker: "META",
    score: 80,
    discovery_origin: ["FLOW", "BREAKOUT"],
    contract_horizon: "ZERO_DTE",
    direction: "long",
    play_type: "DIRECTIONAL",
    actual_dte_at_commit: 0,
    gate: { verdict: "COMMIT" },
  } as import("./board").EnrichedZeroDteSetup;

  assert.equal(await persistDiscoveryCommitEvents([setup]), 1);
  assert.equal(await persistDiscoveryCommitEvents([setup]), 0);
  assert.equal(state.inserted[0]!.kind, "commit");
});

// REGRESSION (zerodte-discovery-rejection-cursor-race): DISCOVERY_EVENT_CURSOR_KEY is ONE
// shared platform_meta row that persistDiscoveryGateBlockedEvents and persistDiscoveryCommitEvents
// both read-modify-write, and in production both are called as unawaited (`void ... .catch(...)`)
// fire-and-forget sites within the SAME warmZeroDteBoard/persistZeroDteScan cycle (scan.ts:2362,
// :2665), so they can race for real. Before the lock fix: two concurrent calls each read the
// SAME base cursor before either writes, mutate their own in-memory copy for a DIFFERENT ticker,
// then both write the whole blob back — whichever setMeta resolves last clobbers the other's
// addition entirely. This must FAIL before the tryAdvisoryLock/releaseAdvisoryLock serialization
// fix (both tickers' cursor entries do NOT survive) and PASS after it.
test("persistDiscoveryGateBlockedEvents: two concurrent calls for DIFFERENT tickers both survive in the cursor (no lost update)", async () => {
  resetState();
  const { persistDiscoveryGateBlockedEvents } = await mod();
  const rejA = {
    ticker: "AAA",
    gate_failed: "min_gross",
    direction: "long",
    reason: "below floor",
    gross_premium: 50_000,
    threshold: 200_000,
  } as import("./board").ZeroDteGateRejection;
  const rejB = {
    ticker: "BBB",
    gate_failed: "min_dominance",
    direction: "short",
    reason: "no dominant strike",
    gross_premium: 90_000,
    threshold: 0.65,
  } as import("./board").ZeroDteGateRejection;

  const [writtenA, writtenB] = await Promise.all([
    persistDiscoveryGateBlockedEvents([rejA]),
    persistDiscoveryGateBlockedEvents([rejB]),
  ]);

  assert.equal(writtenA, 1);
  assert.equal(writtenB, 1);
  assert.equal(state.inserted.length, 2, "both rows must be inserted");

  // The real assertion: the CURSOR blob itself must retain both tickers' entries, not just the
  // inserted rows — a lost update here is what causes the SAME ticker to re-log as a "new"
  // transition on the next tick even though it was already logged.
  const cursor = JSON.parse(state.cursor ?? "{}") as Record<string, unknown>;
  assert.ok(cursor["2026-07-06:AAA"], "AAA's cursor entry must survive the race");
  assert.ok(cursor["2026-07-06:BBB"], "BBB's cursor entry must survive the race — a lost update would drop it");
});

// Mirrors the above but races persistDiscoveryGateBlockedEvents against persistDiscoveryCommitEvents
// — the two DIFFERENT functions that share this cursor and really do race concurrently in
// warmZeroDteBoard/persistZeroDteScan (scan.ts:2362 vs :2665), not just two calls of the same one.
test("persistDiscoveryGateBlockedEvents + persistDiscoveryCommitEvents racing for DIFFERENT tickers both survive (no lost update)", async () => {
  resetState();
  const { persistDiscoveryGateBlockedEvents, persistDiscoveryCommitEvents } = await mod();
  const rej = {
    ticker: "CCC",
    gate_failed: "min_gross",
    direction: "long",
    reason: "below floor",
    gross_premium: 50_000,
    threshold: 200_000,
  } as import("./board").ZeroDteGateRejection;
  const setup = {
    ticker: "DDD",
    score: 80,
    discovery_origin: ["FLOW"],
    contract_horizon: "ZERO_DTE",
    direction: "long",
    play_type: "DIRECTIONAL",
    actual_dte_at_commit: 0,
    gate: { verdict: "COMMIT" },
  } as import("./board").EnrichedZeroDteSetup;

  const [writtenRej, writtenCommit] = await Promise.all([
    persistDiscoveryGateBlockedEvents([rej]),
    persistDiscoveryCommitEvents([setup]),
  ]);

  assert.equal(writtenRej, 1);
  assert.equal(writtenCommit, 1);
  assert.equal(state.inserted.length, 2);

  const cursor = JSON.parse(state.cursor ?? "{}") as Record<string, unknown>;
  assert.ok(cursor["2026-07-06:CCC"], "the gate-blocked write's cursor entry must survive");
  assert.ok(cursor["2026-07-06:DDD"], "the commit write's cursor entry must survive — a lost update would drop it");
});
