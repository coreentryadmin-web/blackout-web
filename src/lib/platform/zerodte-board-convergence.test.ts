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

  const warnCalls: unknown[][] = [];
  const restore = mock.method(console, "warn", (...args: unknown[]) => {
    warnCalls.push(args);
  });

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

    // 2026-10-02: this fallback fired live in production with ZERO matching CloudWatch Logs
    // lines — the other upstream_ok:false route (readZeroDteLedgerChecked) had just been fixed
    // to log its error, which made the silence on THIS route conspicuous. Asserts it now logs.
    const fallbackWarn = warnCalls.find((args) => String(args[0]).includes("[zerodte-board-fallback]"));
    assert.ok(fallbackWarn, "the minimal-fallback path must log when it fires, not fail silently");
    assert.match(String(fallbackWarn![0]), /maxBlockMs=500ms/);
  } finally {
    restore.mock.restore();
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

// ── as_of REGRESSION (live 2026-08-17) ───────────────────────────────────────────────
// Symptom: consecutive member polls saw `as_of` walk BACKWARD by 8m16s while the setup
// count flipped between 7 and 147 — the board serving two snapshots from different
// discovery phases. Cause: `buildAndPublishBoard` published UNCONDITIONALLY, and three
// publishers race (background SWR w/ lock, cold build w/o lock, cron warmer w/o lock).
// A build takes 5-45s, so a slow builder that STARTED earlier could finish LAST and
// overwrite a fresher snapshot. The publish is now monotonic on `as_of`.

test("boardSnapshotIsNewer: a late-finishing older build never displaces a fresher snapshot", async () => {
  const { boardSnapshotIsNewer } = await import("./zerodte-service");
  const older = "2026-08-17T18:34:00.000Z";
  const newer = "2026-08-17T18:42:16.000Z"; // the live 8m16s gap

  assert.equal(boardSnapshotIsNewer(newer, older), true, "a genuinely newer build publishes");
  assert.equal(boardSnapshotIsNewer(older, newer), false, "the stale build is refused — this IS the bug");
  assert.equal(
    boardSnapshotIsNewer(newer, newer),
    false,
    "a tie carries no new information; re-writing it only re-opens the race window"
  );
});

test("boardSnapshotIsNewer: unparseable timestamps fail in the safe direction", async () => {
  const { boardSnapshotIsNewer } = await import("./zerodte-service");
  const stamped = "2026-08-17T18:42:16.000Z";

  // Nothing valid published yet → publish, else the lane could never start.
  assert.equal(boardSnapshotIsNewer(stamped, null), true);
  assert.equal(boardSnapshotIsNewer(stamped, undefined), true);
  assert.equal(boardSnapshotIsNewer(stamped, "not-a-date"), true);
  // An UNSTAMPED build must never displace a stamped one — it cannot be shown to be newer,
  // and publishing it would strand the lane on a board whose age nobody can evaluate.
  assert.equal(boardSnapshotIsNewer(null, stamped), false);
  assert.equal(boardSnapshotIsNewer("not-a-date", stamped), false);
  assert.equal(boardSnapshotIsNewer(undefined, undefined), false);
});

test("no clobber: a slow build finishing AFTER a fresher peer publish leaves the fresh snapshot intact", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");
  const key = "zerodte:board:snapshot:v1";
  const prev = process.env.ZERODTE_BOARD_MAX_BLOCK_MS;
  process.env.ZERODTE_BOARD_MAX_BLOCK_MS = "5000"; // let the slow build be awaited
  sharedState.slowScanMs = 400;

  try {
    // Cold miss → this replica starts a slow build. Its `as_of` will be stamped ~400ms from now.
    const inflight = getZeroDteBoardPayload();

    // Meanwhile a PEER replica (or the cron warmer) publishes a fresher board. Stamped ahead so
    // it is unambiguously newer than whatever the slow build ends up stamping.
    await waitFor(() => sharedState.scanCalls >= 1, 500);
    const peerAsOf = new Date(Date.now() + 30_000).toISOString();
    const peer = { available: true, as_of: peerAsOf, upstream_ok: true, setups: [{ ticker: "PEER" }] };
    sharedState.store.set(key, { value: JSON.stringify(peer), expiresAt: Date.now() + 600_000 });

    const served = await inflight;

    const stored = JSON.parse(sharedState.store.get(key)!.value);
    assert.equal(stored.as_of, peerAsOf, "the slow build did NOT overwrite the fresher peer snapshot");
    assert.equal(
      served.as_of,
      peerAsOf,
      "and the slow builder's own caller is handed the FRESHER board, not the stale one it just finished"
    );
  } finally {
    sharedState.slowScanMs = 0;
    if (prev === undefined) delete process.env.ZERODTE_BOARD_MAX_BLOCK_MS;
    else process.env.ZERODTE_BOARD_MAX_BLOCK_MS = prev;
  }
});

test("stale local fallback: the per-replica last-good board is bounded by age, not served forever", async () => {
  const { localBoardIsServable } = await import("./zerodte-service");
  const now = Date.parse("2026-08-17T18:42:16.000Z");
  const min = 60_000;

  assert.equal(localBoardIsServable(new Date(now - 30_000).toISOString(), now), true, "30s old — a fine last resort");
  assert.equal(localBoardIsServable(new Date(now - 9 * min).toISOString(), now), true, "9m — inside the 10m ceiling");
  assert.equal(
    localBoardIsServable(new Date(now - 11 * min).toISOString(), now),
    false,
    "11m — past the ceiling. This is the second as_of-regression source: unbounded, it served an old session's roster as live"
  );
  assert.equal(localBoardIsServable(new Date(now - 6 * 60 * min).toISOString(), now), false, "6h — emphatically not current");
  // An undateable board can't be shown to be current, so it is not servable as one.
  assert.equal(localBoardIsServable(null, now), false);
  assert.equal(localBoardIsServable("not-a-date", now), false);
});

// BUG FIXED 2026-10-08: the shared Redis snapshot's "soft-stale, serve anyway" branch
// (getZeroDteBoardPayload's second `if`) used to be unreachable — its ceiling equaled BOTH
// the "fully fresh" ceiling above it AND the Redis TTL the snapshot was published with, so by
// the instant a snapshot's age would have qualified for "stale but servable", the key had ALSO
// just expired out of Redis and `readSharedBoardSnapshot()` returned null. Every read of a
// snapshot older than 10 minutes therefore fell straight through to the cold-build-and-block
// path, which under real load (board builds measured live at 20-45s) routinely blocks past
// `maxBlockMs` (default 3s) and serves the synthetic `upstream_ok:false` empty fallback —
// confirmed live 2026-10-08: 11 "cold build still running past maxBlockMs" log lines in one
// 30-minute RTH CloudWatch window while the real discovery pipeline was finding 180-200+ real
// setups every cycle in the same window. This proves the fix restores the two-tier design the
// code's own comments already described: fresh (<=10m) served instantly; stale-but-present
// (10m-20m, now genuinely reachable because the Redis TTL was widened to outlive it) served
// immediately too, just with a background rebuild kicked rather than blocking on one.
test("stale-while-revalidate: a shared snapshot older than the fresh ceiling but still within the (now-widened) Redis TTL is served as-is, not replaced by the empty upstream_ok:false fallback", async () => {
  const { getZeroDteBoardPayload } = await import("./zerodte-service");
  const key = "zerodte:board:snapshot:v1";

  const twelveMinAgo = Date.now() - 12 * 60_000; // past the 10m "fresh" ceiling...
  const asOf = new Date(twelveMinAgo).toISOString();
  const staleBoard = {
    available: true,
    as_of: asOf,
    upstream_ok: true,
    setups: [{ ticker: "STALE" }],
    discovery_health: { BREAKOUT: { status: "ok", setups: 1 }, PIN: { status: "ok", setups: 0 } },
  };
  // ...but published with the PRODUCTION Redis TTL (1200s from its own as_of), so it is still
  // present in the store right now — exactly the window the dead branch was supposed to cover.
  sharedState.store.set(key, { value: JSON.stringify(staleBoard), expiresAt: twelveMinAgo + 1_200_000 });

  const served = await getZeroDteBoardPayload();

  assert.equal(served.upstream_ok, true, "the real stale board's own upstream_ok must be served, not the fail-closed fallback's `false`");
  assert.deepEqual(served.setups, [{ ticker: "STALE" }], "the real stale board's own setups must be served — an empty [] means the dead branch swallowed it and fell to the synthetic fallback instead");

  // The stale-serve branch kicks an UNLOCKED cold rebuild (kickColdBoardBuild) rather than
  // just serving the old copy forever — confirm that actually fired.
  await waitFor(() => sharedState.scanCalls >= 1, 1_000);
  assert.equal(sharedState.scanCalls >= 1, true, "serving the stale snapshot must still kick a background rebuild so the cycle advances");
});
