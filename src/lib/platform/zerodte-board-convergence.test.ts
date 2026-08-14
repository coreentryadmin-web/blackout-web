// fix/zerodte-board-convergence — proves the served 0DTE board is ONE shared, converged
// snapshot every replica reads (no more per-replica flip-flop), that the snapshot still
// ADVANCES each cycle (liveness preserved), and that a shared-store outage fails SOFT to a
// local build (never a blank board).
//
// The bug (live 2026-07-24): setup SCORES flip-flopped between two values across a member's
// ~5s poll (QQQ 68↔50, MU 52↔56, SNDK 60↔52) while `as_of` advanced every round — two web
// replicas each served their OWN in-process board build (per-replica score inputs), and the
// poll round-robined between them. The marks did NOT flip because they ride the shared
// `nw:optmark:` Redis write-through. The fix gives the whole board that same shared-read
// property via a Redis snapshot (zerodte:board:snapshot:v1).
//
// Mocks use RELATIVE specifiers (the CI tsx ESM loader can't resolve "@/" aliases inside
// mock.module) and a mutable `sharedState` driving each scenario — node:test's registrations
// persist for the process, so it's one mock, many scenarios (mirrors zerodte-service.test.ts).

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Build counter (scanZeroDteBoard runs exactly once per buildZeroDteBoardPayload) + a
 *  controllable in-memory stand-in for the shared Redis cache. */
const sharedState = {
  scanCalls: 0,
  throwMode: false,
  slowScanMs: 0,
  store: new Map<string, { value: string; expiresAt: number }>(),
};

mock.module("server-only", { namedExports: {} });
mock.module("../bie/ecosystem-context", {
  namedExports: { fetchNighthawkEchoForTickers: async () => new Map() },
});
mock.module("../zerodte/scan", {
  namedExports: {
    readZeroDteLedgerChecked: async () => ({ rows: [], committed_known: true }),
    readZeroDteLedger: async () => [],
    syncLedgerLiveState: async (rows: unknown[]) => rows,
    scanZeroDteBoard: async () => {
      sharedState.scanCalls += 1;
      if (sharedState.slowScanMs > 0) {
        await new Promise((r) => setTimeout(r, sharedState.slowScanMs));
      }
      return {
        setups: [],
        nighthawk_covered: [],
        upstream_ok: true,
        rejections: [],
        market_state: { confidence: 0, rail_weights: { FLOW: 1, BREAKOUT: 1, PIN: 1 }, regime_structure: null },
        // Per-lane discovery provenance — a required field on ZeroDteScanResult, so the fake scan
        // must carry it too or the payload gains a `discovery_health: undefined` key that survives
        // an in-process compare but vanishes through JSON.
        discovery_health: {
          BREAKOUT: { status: "ok", setups: 0 },
          PIN: { status: "ok", setups: 0 },
        },
      };
    },
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
// Controllable shared cache: a real (Map-backed) store when healthy, or a throwing store
// to exercise the fail-soft fallback. This is the cross-replica Redis stand-in — two reads
// against the SAME store simulate two replicas reading one converged snapshot.
mock.module("../shared-cache", {
  namedExports: {
    sharedCacheGet: async (key: string) => {
      if (sharedState.throwMode) throw new Error("shared-cache down");
      const hit = sharedState.store.get(key);
      if (hit && hit.expiresAt > Date.now()) return JSON.parse(hit.value);
      return null;
    },
    sharedCacheSet: async (key: string, value: unknown, ttlSec: number) => {
      if (sharedState.throwMode) throw new Error("shared-cache down");
      sharedState.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSec * 1000 });
    },
    sharedCacheSetNx: async (key: string, value: unknown, ttlSec: number) => {
      if (sharedState.throwMode) throw new Error("shared-cache down");
      const hit = sharedState.store.get(key);
      if (hit && hit.expiresAt > Date.now()) return false;
      sharedState.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSec * 1000 });
      return true;
    },
    // del never throws — reset must always be able to clear latches.
    sharedCacheDel: async (key: string) => {
      sharedState.store.delete(key);
    },
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

async function waitFor(pred: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  const { _resetZeroDteBoardSnapshotForTest } = await import("./zerodte-service");
  await _resetZeroDteBoardSnapshotForTest();
  sharedState.scanCalls = 0;
  sharedState.throwMode = false;
  sharedState.slowScanMs = 0;
  sharedState.store.clear();
});

test("convergence: two reads within a cycle return the IDENTICAL shared snapshot (one build, not two)", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");

  const first = await getZeroDteBoardPayload();
  // Second read simulates a DIFFERENT replica: no local board is retained (the only local
  // state is the inflight promise, already resolved), so it reads purely from the shared
  // store — exactly the cross-replica path that used to flip-flop.
  const second = await getZeroDteBoardPayload();

  assert.equal(sharedState.scanCalls, 1, "the second read served the shared snapshot — it did NOT re-derive per replica");
  assert.equal(first.as_of, second.as_of, "both reads return the byte-identical converged board (no flip-flop)");
  assert.deepEqual(first, second);
});

test("liveness: the shared snapshot ADVANCES across cycles — a new cycle rebuilds, as_of moves forward", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");

  const first = await getZeroDteBoardPayload();
  assert.equal(sharedState.scanCalls, 1);

  // Simulate the snapshot expiring at the end of a cycle (Redis TTL / cron cadence).
  sharedState.store.clear();
  await new Promise((r) => setTimeout(r, 2)); // guarantee a distinct as_of timestamp
  const second = await getZeroDteBoardPayload();

  assert.equal(sharedState.scanCalls, 2, "a fresh cycle rebuilds the board (never frozen on a stale snapshot)");
  assert.notEqual(first.as_of, second.as_of, "as_of advances — liveness preserved, not traded for staleness");
});

test("liveness (SWR): a snapshot past the soft window is served immediately AND advanced by a single background rebuild", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");

  const first = await getZeroDteBoardPayload();
  assert.equal(sharedState.scanCalls, 1);
  const firstAsOf = first.as_of;

  // Age the stored snapshot past the soft-refresh window (but under the serve ceiling) so
  // the next read serves it instantly yet kicks a background rebuild.
  const key = "zerodte:board:snapshot:v1";
  const entry = sharedState.store.get(key)!;
  const aged = JSON.parse(entry.value);
  aged.as_of = new Date(Date.now() - 9_000).toISOString(); // > 5s soft, < 60s serve ceiling
  sharedState.store.set(key, { value: JSON.stringify(aged), expiresAt: entry.expiresAt });

  const served = await getZeroDteBoardPayload();
  assert.equal(served.as_of, aged.as_of, "the (slightly stale) shared snapshot is served without blocking on a rebuild");

  // The single-writer background refresh advances the snapshot to a fresh build.
  await waitFor(() => sharedState.scanCalls >= 2);
  assert.equal(sharedState.scanCalls, 2, "exactly one background rebuild fired for the cycle");
  const republished = JSON.parse(sharedState.store.get(key)!.value);
  assert.notEqual(republished.as_of, aged.as_of, "the shared snapshot was republished with a newer as_of");
});

test("SWR hard window: a snapshot aged past the old 30s hard gate but still within Redis TTL is served without blocking (no 504 cold path)", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");

  await getZeroDteBoardPayload();
  assert.equal(sharedState.scanCalls, 1);

  const key = "zerodte:board:snapshot:v1";
  const entry = sharedState.store.get(key)!;
  const aged = JSON.parse(entry.value);
  aged.as_of = new Date(Date.now() - 35_000).toISOString(); // > 30s old hard gate, < 60s TTL
  sharedState.store.set(key, { value: JSON.stringify(aged), expiresAt: entry.expiresAt });

  const served = await getZeroDteBoardPayload();
  assert.equal(served.as_of, aged.as_of, "35s-aged snapshot still served SWR — member poll must not block on cold build");
  assert.equal(sharedState.scanCalls, 1, "no blocking rebuild on the read path — background SWR only");

  await waitFor(() => sharedState.scanCalls >= 2);
  assert.equal(sharedState.scanCalls, 2, "background rebuild eventually advances the snapshot");
});

test("never-block: cold miss past maxBlockMs returns minimal fallback immediately — does not await the slow build", async () => {
  const prev = process.env.ZERODTE_BOARD_MAX_BLOCK_MS;
  process.env.ZERODTE_BOARD_MAX_BLOCK_MS = "500";
  sharedState.slowScanMs = 1_200;

  try {
    const { getZeroDteBoardPayload } = await import("./zerodte-service");
    const t0 = Date.now();
    const board = await getZeroDteBoardPayload();
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 800, `expected fast handoff, got ${elapsed}ms`);
    assert.equal(board.available, true);
    assert.equal(board.upstream_ok, false, "minimal fallback while cold build still running");
    assert.deepEqual(board.setups, []);
    assert.equal(board.session.heat.state, "RTH", "minimal fallback uses live ET clock, not a hardcoded noon");
  } finally {
    sharedState.slowScanMs = 0;
    if (prev === undefined) delete process.env.ZERODTE_BOARD_MAX_BLOCK_MS;
    else process.env.ZERODTE_BOARD_MAX_BLOCK_MS = prev;
  }
});

test("fail-soft: a shared-store outage still serves a freshly built board — never a blank board", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");
  sharedState.throwMode = true;

  const board = await getZeroDteBoardPayload();

  assert.equal(board.available, true, "a Redis outage degrades to a local build, not an unavailable/blank board");
  assert.ok(sharedState.scanCalls >= 1, "fell back to a local derivation when the shared snapshot was unreadable");
  assert.ok(Array.isArray(board.ledger) && Array.isArray(board.setups), "the fallback board is structurally intact");
});
