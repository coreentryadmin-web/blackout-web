/**
 * Thermal Discord orchestration — breaches (SPY/SPX/QQQ), scheduled posts, EOD recap.
 * Cache-reader only; shared by main cron + 5m breach poller.
 */
import { postDiscordWebhook, postDiscordWebhookWithFiles } from "@/lib/discord-post";
import { todayEt } from "@/lib/et-date";
import { currentSessionDateEt } from "@/lib/discord-eod-recap";
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
  let state = await loadThermalBreachState();
  let posted = 0;
  const tickers: string[] = [];

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
      posted++;
      tickers.push(ev.ticker);
      state = nextState;
    }
  }

  await saveThermalBreachState(state);
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
