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
import { logCronRun } from "@/lib/cron-run";
import { shouldRunVectorBeadRecorder } from "@/lib/process-role";
import {
  recordSharedUniverseWallSamples,
  recordActiveNonUniverseWallSamples,
} from "@/features/vector/lib/vector-bead-recorder-core";
import {
  VECTOR_BEAD_RECORD_TICK_MS,
  VECTOR_BEAD_RECORD_ACTIVE_TICK_MS,
} from "@/features/vector/lib/vector-bead-recorder-logic";
import {
  alertWsLeaderFailClosedOnce,
  clearWsLeaderFailClosedAlert,
  wsLeaderShouldFailOpenWithoutRedis,
} from "@/lib/ws/leader-lock-shared";
import { newLockToken, releaseFencedLock, renewFencedLock, type FencedRedis } from "@/lib/ws/leader-lock-fencing";

const LEADER_KEY = "vector:bead:recorder:leader";
const LEADER_TTL_SEC = 45;
/** Observability heartbeat — EventBridge backup cron may be unprovisioned; keep cron_job_runs fresh. */
const HEARTBEAT_INTERVAL_MS = 30_000;
const LOCK_TOKEN = newLockToken();

type IoredisLockExtra = FencedRedis & {
  set(k: string, v: string, ex: string, ttl: number, nx: string): Promise<string | null>;
};

let started = false;
let isLeader = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let activeTickTimer: ReturnType<typeof setInterval> | null = null;
let leaderRefreshTimer: ReturnType<typeof setInterval> | null = null;
let recordInFlight = false;
let activeRecordInFlight = false;
let lastHeartbeatAt = 0;
let heartbeatInFlight = false;

async function getLockRedis(): Promise<IoredisLockExtra | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  try {
    const { makeRedis } = await import("./make-redis");
    const client = await makeRedis("vector-bead-recorder", url, { maxRetriesPerRequest: 1 });
    return client as unknown as IoredisLockExtra;
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
      return true;
    }
    clearWsLeaderFailClosedAlert("vector-bead-recorder");
    const result = await redis.set(LEADER_KEY, LOCK_TOKEN, "EX", LEADER_TTL_SEC, "NX");
    return result === "OK";
  } catch {
    if (!wsLeaderShouldFailOpenWithoutRedis()) {
      alertWsLeaderFailClosedOnce("vector-bead-recorder");
      return false;
    }
    return true;
  }
}

function startLeaderRefresh(): void {
  if (leaderRefreshTimer) return;
  leaderRefreshTimer = setInterval(() => {
    if (!isLeader) return;
    void getLockRedis()
      .then(async (redis) => {
        if (!redis) return;
        const stillMine = await renewFencedLock(redis, LEADER_KEY, LOCK_TOKEN, LEADER_TTL_SEC);
        if (!stillMine) {
          console.warn(
            "[vector-bead-recorder] lost cluster lead to another replica (stalled past TTL) — standing down"
          );
          isLeader = false;
        }
      })
      .catch(() => undefined);
  }, 15_000);
  (leaderRefreshTimer as unknown as { unref?: () => void }).unref?.();
}

function releaseLead(): void {
  isLeader = false;
  if (leaderRefreshTimer) {
    clearInterval(leaderRefreshTimer);
    leaderRefreshTimer = null;
  }
  void getLockRedis()
    .then((redis) => redis && releaseFencedLock(redis, LEADER_KEY, LOCK_TOKEN))
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
  if (recordInFlight) return;

  if (!isLeader) {
    isLeader = await tryAcquireLead();
    if (!isLeader) return;
    startLeaderRefresh();
    console.log("[vector-bead-recorder] acquired cluster lead — 5s universe + 15s active-viewer bead recording");
  }

  recordInFlight = true;
  try {
    const result = await recordSharedUniverseWallSamples();
    if (result.total > 0 && result.recorded === 0) {
      console.warn(
        `[vector-bead-recorder] zero samples recorded (${result.failed}/${result.total} failed, ${result.elapsedMs}ms)`
      );
    }
    void maybeLogLeaderHeartbeat();
  } catch (err) {
    console.error(
      "[vector-bead-recorder] tick error:",
      err instanceof Error ? err.message : err
    );
  } finally {
    recordInFlight = false;
  }
}

async function activeTick(): Promise<void> {
  if (!isEtCashRth()) return;
  if (activeRecordInFlight || !isLeader) return;

  activeRecordInFlight = true;
  try {
    const result = await recordActiveNonUniverseWallSamples();
    if (result.total > 0 && result.recorded === 0) {
      console.warn(
        `[vector-bead-recorder] active non-universe: zero samples (${result.failed}/${result.total} failed, ${result.elapsedMs}ms)`
      );
    }
  } catch (err) {
    console.error(
      "[vector-bead-recorder] active tick error:",
      err instanceof Error ? err.message : err
    );
  } finally {
    activeRecordInFlight = false;
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
