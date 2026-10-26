/**
 * Thermal Discord orchestration — breaches (SPY/SPX/QQQ), scheduled posts, EOD recap.
 * Cache-reader only; shared by main cron + 5m breach poller.
 */
import { postDiscordWebhook, postDiscordWebhookWithFiles } from "@/lib/discord-post";
import { todayEt } from "@/lib/et-date";
import { currentSessionDateEt } from "@/lib/discord-eod-recap";
import { tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import {
  renderThermalDiscordCardPng,
  type ThermalCardColumn,
} from "@/lib/thermal-discord-card";
import {
  extractWallSnapshot,
  loadThermalWallSnapshot,
  resolveThermalDiscordMode,
  saveThermalWallSnapshot,
} from "@/lib/thermal-discord-cadence";
import {
  buildThermalBreachAlertEmbed,
  buildThermalDiscordEmbedWithExtras,
  buildThermalEodRecapEmbed,
  detectThermalBreaches,
} from "@/lib/thermal-discord-extras";
import {
  filterNewBreachAlerts,
  loadThermalBreachState,
  loadThermalSpotMeta,
  persistSpotSnapshotAfterTick,
  priorSpotsForBreaches,
  resetThermalBreachStateForSession,
  saveThermalBreachState,
  shouldSeedSessionSpots,
} from "@/lib/thermal-discord-breach-state";
import { claimThermalEodRecap, isThermalEodRecapDue } from "@/lib/thermal-discord-eod";

export type ThermalBreachRunResult = {
  seeded: boolean;
  detected: number;
  posted: number;
  tickers: string[];
};

// Lock for the breach-state read-modify-write below (round 115, sibling of the X-marketing
// lane's recordPostHook/markTweetReplied/recordBudgetUse fixes and the GEX-regime-events
// cursor fix — same bug shape, different file). This module's own header comment says it:
// "shared by main cron + 5m breach poller." Both `/api/cron/thermal-discord` (every 15m) and
// its own `?breach_only=1` 5-minute poller invoke the SAME route, and both reach this function
// with NO coordination between them. At :00/:15/:30/:45 the two schedules land on the SAME
// wall-clock minute, so two requests can genuinely overlap.
//
// `loadThermalBreachState()` -> compute per-event diff -> `saveThermalBreachState()` is an
// unlocked read-modify-write against the single shared `thermal-discord:breach-state:v1`
// Redis key. If two overlapping calls both read the same base state before either saves:
// (a) both can independently decide the SAME crossing is "new" (the per-ticker+kind side
//     hasn't flipped yet in either call's view) and both post — a duplicate Discord alert for
//     one real crossing; and
// (b) if the two calls detect DIFFERENT crossings (e.g. the main cron sees SPY's flip cross
//     while the poller, off its own slightly-later fetch, sees QQQ's call wall break), whichever
//     save lands last wins outright — the other call's state update is silently discarded, so
//     the next tick re-detects that same crossing as "new" again and double-posts a crossing
//     that should already have been marked seen.
//
// Fixed with the same `tryAdvisoryLock`/`releaseAdvisoryLock` primitive the X-marketing/GEX
// fixes use, a NEW dedicated lock key, and the same bounded-retry-then-unlocked-fallback shape
// (never deadlock the alert path, and never silently drop a session's breach alerts forever
// if Postgres is briefly unavailable or a holder gets stuck).
const THERMAL_BREACH_STATE_WRITE_LOCK = "thermal-discord-breach-state-write";
const THERMAL_BREACH_LOCK_MAX_ATTEMPTS = 30;
const THERMAL_BREACH_LOCK_RETRY_MS = 60;

async function withThermalBreachStateLock<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < THERMAL_BREACH_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const acquired = await tryAdvisoryLock(THERMAL_BREACH_STATE_WRITE_LOCK);
    if (!acquired) {
      await new Promise((r) => setTimeout(r, THERMAL_BREACH_LOCK_RETRY_MS));
      continue;
    }
    try {
      return await fn();
    } finally {
      await releaseAdvisoryLock(THERMAL_BREACH_STATE_WRITE_LOCK);
    }
  }
  // Could not get the lock after bounded retries (e.g. a stuck holder, or Postgres briefly
  // down) — fall back to the old unlocked behavior rather than dropping this tick's breach
  // alerts entirely. Worse than the locked path, but no worse than before this fix, and
  // logged so a stuck lock is visible rather than silently eating retries forever.
  console.warn(
    `[thermal-discord-run] could not acquire ${THERMAL_BREACH_STATE_WRITE_LOCK} after ${THERMAL_BREACH_LOCK_MAX_ATTEMPTS} attempts — running breach-state update unlocked`
  );
  return fn();
}

/** Event-driven wall/flip alerts for every ticker with live spot + structure. */
export async function runThermalBreachAlerts(
  webhook: string,
  columns: ThermalCardColumn[],
  sessionDate: string = todayEt()
): Promise<ThermalBreachRunResult> {
  const meta = await loadThermalSpotMeta();
  const seeding = shouldSeedSessionSpots(meta, sessionDate);

  if (seeding) {
    await persistSpotSnapshotAfterTick(columns, sessionDate);
    await resetThermalBreachStateForSession();
    return { seeded: true, detected: 0, posted: 0, tickers: [] };
  }

  const priorSpots = priorSpotsForBreaches(meta, sessionDate);
  const detected = detectThermalBreaches(columns, priorSpots);

  const { posted, tickers } = await withThermalBreachStateLock(async () => {
    let state = await loadThermalBreachState();
    let postedCount = 0;
    const postedTickers: string[] = [];

    // Per-event post + state advance — a failed webhook must not burn the alert slot.
    for (const ev of detected) {
      const { alerts, state: nextState } = filterNewBreachAlerts([ev], state);
      if (!alerts.length) continue;
      const ok = await postDiscordWebhook(
        webhook,
        { embeds: [buildThermalBreachAlertEmbed(ev)] },
        `thermal-breach-${ev.ticker.toLowerCase()}`
      );
      if (ok) {
        postedCount++;
        postedTickers.push(ev.ticker);
        state = nextState;
      }
    }

    await saveThermalBreachState(state);
    return { posted: postedCount, tickers: postedTickers };
  });

  await persistSpotSnapshotAfterTick(columns, sessionDate);
  return { seeded: false, detected: detected.length, posted, tickers };
}

export async function runThermalEodRecap(
  webhook: string,
  columns: ThermalCardColumn[],
  opts: { bypassDedup?: boolean; now?: Date } = {}
): Promise<{ due: boolean; claimed: boolean; delivered: boolean }> {
  const now = opts.now ?? new Date();
  if (!isThermalEodRecapDue(now)) {
    return { due: false, claimed: false, delivered: false };
  }

  const sessionDate = currentSessionDateEt(now);
  const claimed = await claimThermalEodRecap(sessionDate, opts.bypassDedup ?? false);
  if (!claimed) {
    return { due: true, claimed: false, delivered: false };
  }

  const delivered = await postDiscordWebhook(
    webhook,
    { embeds: [buildThermalEodRecapEmbed(columns, sessionDate)] },
    "thermal-eod-recap"
  );
  return { due: true, claimed: true, delivered };
}

export async function runThermalScheduledPost(
  webhook: string,
  columns: ThermalCardColumn[],
  opts: { forceFull?: boolean; now?: Date } = {}
): Promise<{ mode: "full" | "pulse"; delivered: boolean; bytes?: number }> {
  const prevWalls = await loadThermalWallSnapshot();
  const mode = resolveThermalDiscordMode(columns, prevWalls, opts.now ?? new Date(), opts.forceFull ?? false);
  const includeShiftLeaders = mode === "full";
  const embed = buildThermalDiscordEmbedWithExtras(columns, mode, { includeShiftLeaders });

  if (mode === "full") {
    const png = await renderThermalDiscordCardPng(columns);
    const delivered = await postDiscordWebhookWithFiles(
      webhook,
      { embeds: [embed] },
      [{ filename: "thermal-desk.png", bytes: png, contentType: "image/png" }],
      "thermal-desk"
    );
    if (delivered) await saveThermalWallSnapshot(extractWallSnapshot(columns));
    return { mode, delivered, bytes: png.byteLength };
  }

  const delivered = await postDiscordWebhook(webhook, { embeds: [embed] }, "thermal-pulse");
  if (delivered) await saveThermalWallSnapshot(extractWallSnapshot(columns));
  return { mode, delivered };
}
