/**
 * In-process Vector bead recorder — 5s cadence for the full shared universe (~100 tickers).
 *
 * EventBridge's cron floor is 1 minute, so sub-minute bead density cannot rely on HTTP crons
 * alone. One cluster leader (Redis SETNX, same pattern as rth-warm-leader) stamps wall-history
 * samples every 5 seconds during cash RTH so SPY/QQQ/NVDA/etc. match SPX rail density
 * without anyone watching Vector.
 *
 * The HTTP cron `/api/cron/vector-bead-record` is a backup + observability hook (logged in
 * cron_job_runs); this leader is the primary 5s writer during RTH.
 */
import { isEtCashRth } from "@/lib/et-market-hours";
import { trackTickerFailures } from "@/features/vector/lib/vector-bead-recorder-logic";
import { logCronRun } from "@/lib/cron-run";
import { shouldRunVectorBeadRecorder } from "@/lib/process-role";
import {
  recordSharedUniverseWallSamples,
  recordActiveNonUniverseWallSamples,
} from "@/features/vector/lib/vector-bead-recorder-core";
import {
  VECTOR_BEAD_RECORD_TICK_MS,
  VECTOR_BEAD_RECORD_ACTIVE_TICK_MS,
  evaluateSweepBudget,
  type SweepBudgetState,
} from "@/features/vector/lib/vector-bead-recorder-logic";
import {
  alertWsLeaderFailClosedOnce,
  clearWsLeaderFailClosedAlert,
  wsLeaderShouldFailOpenWithoutRedis,
} from "@/lib/ws/leader-lock-shared";
import { newLockToken, releaseFencedLock, renewFencedLock, type FencedRedis } from "@/lib/ws/leader-lock-fencing";
import {
  VECTOR_BEAD_SHARD_COUNT,
  beadShardsForReplica,
} from "@/features/vector/lib/vector-bead-shard";

/**
 * SLOT, not an exclusive lead.
 *
 * The recorder used to elect ONE leader that swept all ~122 tickers alone. Measured on prod
 * 2026-08-12: one market-worker task pinned at 100% CPU for 40 minutes straight while its peer
 * idled at 0.1%, with the sweep running ~6x over its 5s budget. Half the provisioned compute was
 * doing nothing by construction.
 *
 * Each replica now claims a numbered SLOT and sweeps only the shards that map to it, so every
 * running task contributes. Losing a task cannot leave a hole: the lowest live slot adopts every
 * orphaned shard (see beadShardsForReplica), so coverage survives on a single replica — the
 * failure mode a naive `hash % replicas` split would have introduced is exactly the silent
 * partial-recording bug this whole investigation started from.
 */
const SLOT_KEY = (i: number) => `vector:bead:recorder:slot:${i}`;
const LEADER_KEY = "vector:bead:recorder:leader";
const LEADER_TTL_SEC = 45;
/** Observability heartbeat — EventBridge backup cron may be unprovisioned; keep cron_job_runs fresh. */
const HEARTBEAT_INTERVAL_MS = 30_000;
const LOCK_TOKEN = newLockToken();

type IoredisLockExtra = FencedRedis & {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
  get(k: string): Promise<string | null>;
};

let started = false;
let isLeader = false;
/** Which slot this replica holds (null = none yet). Determines the shards it sweeps. */
let mySlot: number | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let activeTickTimer: ReturnType<typeof setInterval> | null = null;
let leaderRefreshTimer: ReturnType<typeof setInterval> | null = null;
let recordInFlight = false;
/**
 * Sweeps allowed to overlap. Two is enough to stop a single slow sweep stalling the next tick
 * while still refusing to stack work without bound — if two are already running, the system is
 * genuinely saturated and starting a third would make it worse, not faster.
 */
const MAX_CONCURRENT_SWEEPS = 2;
let concurrentSweeps = 0;
/** Per-ticker consecutive-failure streaks across sweeps. Bounded by the number of CURRENTLY
 *  failing tickers (successes are deleted), not by universe size. */
const tickerFailureStreaks = new Map<string, number>();
/** Rate-limit state for the sweep-overrun alarm — see evaluateSweepBudget. */
const sweepBudget: SweepBudgetState = { lastLoggedAt: 0 };
let activeRecordInFlight = false;
/**
 * Overlap bound for the ACTIVE (viewer-driven, 15s) lane — the same rule as the universe sweep.
 *
 * `activeRecordInFlight` alone used to DROP the whole lane whenever the previous pass was still
 * running, so one slow viewer ticker cost every other viewer their 15s sample. Two passes may now
 * overlap; a third means the lane is genuinely saturated and starting it would make things worse.
 */
const MAX_CONCURRENT_ACTIVE_SWEEPS = 2;
let concurrentActiveSweeps = 0;
/** Failure streaks for the active lane, kept SEPARATE from the universe map so the two lanes'
 *  cadences (5s vs 15s) can be reported honestly in their own log lines. */
const activeTickerFailureStreaks = new Map<string, number>();
/** Rate-limit state for the active lane's overrun alarm. */
const activeSweepBudget: SweepBudgetState = { lastLoggedAt: 0 };
let lastHeartbeatAt = 0;
let heartbeatInFlight = false;

/** Cached lock connection, reused across calls. Before this cache existed, getLockRedis()
 *  opened a brand-new never-closed ioredis connection on EVERY call — and readHeldSlots()
 *  (below) calls it on every 5s universe tick plus the 15s leader-refresh timer, per replica.
 *  Measured live 2026-09-01: pegged ElastiCache CurrConnections at its 65,000 ceiling for
 *  30+ minutes during RTH (13:33-14:03 UTC), flooding this module + rth-warm-leader.ts (the
 *  same copy-pasted pattern, fixed alongside) with ETIMEDOUT/ECONNRESET/EPIPE, and starving
 *  every OTHER Redis consumer on the shared cluster (uw-rate-limiter, bie-redis-probe) of a
 *  connection slot even though those modules already cache/close correctly. */
let cachedLockRedis: IoredisLockExtra | null = null;

async function getLockRedis(): Promise<IoredisLockExtra | null> {
  if (cachedLockRedis) return cachedLockRedis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const { makeRedis } = await import("./make-redis");
    const client = await makeRedis("vector-bead-recorder", url, { maxRetriesPerRequest: 1 });
    cachedLockRedis = client as unknown as IoredisLockExtra;
    return cachedLockRedis;
  } catch {
    return null;
  }
}

async function tryAcquireLead(): Promise<boolean> {
  try {
    const redis = await getLockRedis();
    if (!redis) {
      if (!wsLeaderShouldFailOpenWithoutRedis()) {
        alertWsLeaderFailClosedOnce("vector-bead-recorder");
        return false;
      }
      // No Redis and configured to fail open: we are the only writer we know of, so take slot 0
      // and (having no peers to observe) sweep everything via orphan adoption.
      mySlot = 0;
      return true;
    }
    clearWsLeaderFailClosedAlert("vector-bead-recorder");
    // Claim the lowest FREE slot. First replica gets 0, second gets 1, and so on; a replica that
    // dies frees its slot for the next task ECS starts.
    for (let i = 0; i < VECTOR_BEAD_SHARD_COUNT; i += 1) {
      const got = await redis.set(SLOT_KEY(i), LOCK_TOKEN, "EX", LEADER_TTL_SEC, "NX");
      if (got === "OK") {
        mySlot = i;
        return true;
      }
    }
    return false;
  } catch {
    if (!wsLeaderShouldFailOpenWithoutRedis()) {
      alertWsLeaderFailClosedOnce("vector-bead-recorder");
      return false;
    }
    mySlot = 0;
    return true;
  }
}

/** Slots currently claimed cluster-wide — drives orphan adoption. Falls back to "only ours" on a
 *  read failure, which makes this replica adopt everything: over-covering beats under-covering. */
async function readHeldSlots(): Promise<number[]> {
  try {
    const redis = await getLockRedis();
    if (!redis) return mySlot == null ? [] : [mySlot];
    const held: number[] = [];
    for (let i = 0; i < VECTOR_BEAD_SHARD_COUNT; i += 1) {
      const v = await redis.get(SLOT_KEY(i));
      if (v) held.push(i);
    }
    return held.length ? held : mySlot == null ? [] : [mySlot];
  } catch {
    return mySlot == null ? [] : [mySlot];
  }
}

function startLeaderRefresh(): void {
  if (leaderRefreshTimer) return;
  leaderRefreshTimer = setInterval(() => {
    if (!isLeader) return;
    void getLockRedis()
      .then(async (redis) => {
        if (!redis) return;
        const key = mySlot == null ? LEADER_KEY : SLOT_KEY(mySlot);
        const stillMine = await renewFencedLock(redis, key, LOCK_TOKEN, LEADER_TTL_SEC);
        if (!stillMine) {
          console.warn(
            "[vector-bead-recorder] lost cluster lead to another replica (stalled past TTL) — standing down"
          );
          isLeader = false;
          mySlot = null;
        }
      })
      .catch(() => undefined);
  }, 15_000);
  (leaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

function releaseLead(): void {
  const slot = mySlot;
  isLeader = false;
  mySlot = null;
  if (leaderRefreshTimer) {
    clearInterval(leaderRefreshTimer);
    leaderRefreshTimer = null;
  }
  void getLockRedis()
    .then((redis) => redis && releaseFencedLock(redis, slot == null ? LEADER_KEY : SLOT_KEY(slot), LOCK_TOKEN))
    .catch(() => undefined);
}

/** Stamp cron_job_runs so admin health / watchdog see the in-process leader as live. */
async function maybeLogLeaderHeartbeat(): Promise<void> {
  if (!isLeader || !isEtCashRth()) return;
  const now = Date.now();
  if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS || heartbeatInFlight) return;
  heartbeatInFlight = true;
  lastHeartbeatAt = now;
  try {
    await logCronRun("vector-bead-record", now, {
      ok: true,
      reason: "in-process leader heartbeat",
      source: "vector-bead-recorder-leader",
    });
  } catch (err) {
    console.warn(
      "[vector-bead-recorder] heartbeat log failed:",
      err instanceof Error ? err.message : err
    );
  } finally {
    heartbeatInFlight = false;
  }
}

async function tick(): Promise<void> {
  if (!isEtCashRth()) return;
  // NO sweep-level in-flight guard any more.
  //
  // This used to be `if (recordInFlight) return`, which dropped the ENTIRE tick — all ~122 tickers
  // — whenever the previous sweep was still running. The achieved cadence became
  // `ceil(sweepMs / 5s) x 5s`, which is exactly what `evaluateSweepBudget` computes and logs: the
  // system already knew it was degrading and had no way to stop. Measured live 2026-08-18: 60s
  // median gaps on TSLA/META/AAPL/AMD against a 5s spec, with holes of 1080s and 1190s.
  //
  // The guard now lives PER TICKER inside the recorder, so a slow name throttles only itself.
  // `recordInFlight` is kept solely to bound overlap: a sweep may overlap the previous one, but we
  // do not stack them without limit, and the per-ticker set plus the shared concurrency ceiling
  // cap the real work either way.
  if (concurrentSweeps >= MAX_CONCURRENT_SWEEPS) return;

  if (!isLeader) {
    isLeader = await tryAcquireLead();
    if (!isLeader) return;
    startLeaderRefresh();
    console.log(
      `[vector-bead-recorder] claimed slot ${mySlot} of ${VECTOR_BEAD_SHARD_COUNT} — 5s universe (own shards) + 15s active-viewer bead recording`
    );
  }

  concurrentSweeps += 1;
  recordInFlight = true;
  try {
    // Sweep OUR shards only, so every replica contributes instead of one doing all 122 while its
    // peers idle. Orphaned shards (a slot no replica holds) are adopted by the lowest live slot,
    // so a single surviving task still covers the whole universe.
    const shards = beadShardsForReplica(mySlot, await readHeldSlots());
    const result = await recordSharedUniverseWallSamples({ shards });
    if (result.total > 0 && result.recorded === 0) {
      console.warn(
        `[vector-bead-recorder] zero samples recorded (${result.failed}/${result.total} failed, ${result.elapsedMs}ms)`
      );
    }
    // A sweep that runs long is not an ERROR — it records everything, just late — so nothing here
    // ever complained about one, and the universe silently recorded at 10s (2026-08-07) and then
    // ~30s (2026-08-12) against a designed 5s. Both times it was found by a member noticing thin
    // beads rather than by us. Name the member-visible consequence, rate-limited.
    const budget = evaluateSweepBudget(
      result.elapsedMs,
      VECTOR_BEAD_RECORD_TICK_MS,
      result.recorded,
      result.total,
      Date.now(),
      sweepBudget
    );
    if (budget.kind === "overrun") {
      console.warn(
        `[vector-bead-recorder] SWEEP OVER BUDGET — universe is recording every ` +
          `${budget.effectiveCadenceMs / 1000}s, not the designed ${budget.budgetMs / 1000}s ` +
          `(sweep ${budget.elapsedMs}ms for ${budget.recorded}/${budget.total} tickers). ` +
          `Ticks are no longer dropped wholesale (the guard is per-ticker), but a sweep this slow ` +
          `still means individual tickers skip their turn — check the busy/deferred counts.`
      );
    }
    // PER-TICKER visibility. The whole-pass warning above only fires when EVERY ticker fails, so a
    // single name going dark while ~121 others succeed logged nothing at all — which is why ASTS's
    // ~10-minute hole on 2026-08-07 left no trace anywhere in CloudWatch. Edge-triggered so a long
    // outage costs two lines, not one per 5s tick; see trackTickerFailures.
    for (const ev of trackTickerFailures(tickerFailureStreaks, result.attempted, result.failedTickers)) {
      if (ev.kind === "dark") {
        console.warn(
          `[vector-bead-recorder] ticker DARK: ${ev.ticker} — ${ev.consecutive} consecutive failed passes (~${ev.consecutive * 5}s of missing beads)`
        );
      } else {
        console.log(
          `[vector-bead-recorder] ticker RECOVERED: ${ev.ticker} — after ${ev.consecutive} consecutive failed passes (~${ev.consecutive * 5}s dark)`
        );
      }
    }
    void maybeLogLeaderHeartbeat();
  } catch (err) {
    console.error(
      "[vector-bead-recorder] tick error:",
      err instanceof Error ? err.message : err
    );
  } finally {
    recordInFlight = false;
    concurrentSweeps = Math.max(0, concurrentSweeps - 1);
  }
}

async function activeTick(): Promise<void> {
  if (!isEtCashRth()) return;
  if (!isLeader) return;
  // Same correction as the universe sweep above, one lane later. This was
  // `if (activeRecordInFlight) return`, i.e. one slow viewer ticker dropped the ENTIRE lane and
  // cost every other viewer their 15s sample — a bigger hole per drop than the universe lane's,
  // on names nobody else is recording. The guard now lives per ticker inside the recorder;
  // `activeRecordInFlight` is kept only so external readers of leader state keep working.
  if (concurrentActiveSweeps >= MAX_CONCURRENT_ACTIVE_SWEEPS) return;

  concurrentActiveSweeps += 1;
  activeRecordInFlight = true;
  try {
    const result = await recordActiveNonUniverseWallSamples();
    if (result.total > 0 && result.recorded === 0) {
      console.warn(
        `[vector-bead-recorder] active non-universe: zero samples (${result.failed}/${result.total} failed, ${result.elapsedMs}ms)`
      );
    }
    const budget = evaluateSweepBudget(
      result.elapsedMs,
      VECTOR_BEAD_RECORD_ACTIVE_TICK_MS,
      result.recorded,
      result.total,
      Date.now(),
      activeSweepBudget
    );
    if (budget.kind === "overrun") {
      console.warn(
        `[vector-bead-recorder] ACTIVE LANE OVER BUDGET — viewer tickers are recording every ` +
          `${budget.effectiveCadenceMs / 1000}s, not the designed ${budget.budgetMs / 1000}s ` +
          `(pass ${budget.elapsedMs}ms for ${budget.recorded}/${budget.total} tickers).`
      );
    }
    // Per-ticker visibility, same reasoning as the universe lane: the whole-pass warning above
    // only fires when EVERY viewer ticker fails, so one name going dark logged nothing at all.
    for (const ev of trackTickerFailures(
      activeTickerFailureStreaks,
      result.attempted,
      result.failedTickers
    )) {
      const seconds = (ev.consecutive * VECTOR_BEAD_RECORD_ACTIVE_TICK_MS) / 1000;
      if (ev.kind === "dark") {
        console.warn(
          `[vector-bead-recorder] active ticker DARK: ${ev.ticker} — ${ev.consecutive} consecutive failed passes (~${seconds}s of missing beads)`
        );
      } else {
        console.log(
          `[vector-bead-recorder] active ticker RECOVERED: ${ev.ticker} — after ${ev.consecutive} consecutive failed passes (~${seconds}s dark)`
        );
      }
    }
  } catch (err) {
    console.error(
      "[vector-bead-recorder] active tick error:",
      err instanceof Error ? err.message : err
    );
  } finally {
    activeRecordInFlight = false;
    concurrentActiveSweeps = Math.max(0, concurrentActiveSweeps - 1);
  }
}

/** Boot the 5s universe + 15s active-viewer bead recorders (idempotent). */
export function ensureVectorBeadRecorder(): void {
  if (started) return;
  if (!shouldRunVectorBeadRecorder()) return;
  started = true;

  const runTick = () => {
    void tick().catch((err) => {
      console.error(
        "[vector-bead-recorder] tick error:",
        err instanceof Error ? err.message : err
      );
    });
  };

  runTick();
  tickTimer = setInterval(runTick, VECTOR_BEAD_RECORD_TICK_MS);
  (tickTimer as unknown as { unref?: () => void }).unref?.();

  const runActiveTick = () => {
    void activeTick().catch((err) => {
      console.error(
        "[vector-bead-recorder] active tick error:",
        err instanceof Error ? err.message : err
      );
    });
  };
  runActiveTick();
  activeTickTimer = setInterval(runActiveTick, VECTOR_BEAD_RECORD_ACTIVE_TICK_MS);
  (activeTickTimer as unknown as { unref?: () => void }).unref?.();

  if (typeof process !== "undefined" && typeof process.once === "function") {
    const onSignal = () => releaseLead();
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }
}
