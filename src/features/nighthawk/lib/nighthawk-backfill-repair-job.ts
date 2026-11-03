import { after } from "next/server";
import { fetchLatestNighthawkEdition, fetchNighthawkEditionByDate } from "@/lib/db";
import { rowToNightHawkEdition, buildEveningEdition } from "@/features/nighthawk/lib/edition-builder";
import { republishBackfilledEdition } from "@/features/nighthawk/lib/post-publish-backfill";
import { todayEt, isTradingDayEt, previousTradingDayEt } from "@/features/nighthawk/lib/session";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";
import { sanitizeForLog } from "@/lib/log-sanitize";

export const NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY = "nighthawk-backfill-repair";

export function inNighthawkBackfillRepairWindow(force: boolean): boolean {
  if (force) return true;
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_HOUR_ET ?? "9"),
    targetMinute: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_MINUTE_ET ?? "0"),
    catchupMin: Number(process.env.NIGHTHAWK_BACKFILL_REPAIR_CATCHUP_MIN ?? "90"),
  });
}

export type NighthawkBackfillRepairJobResult = {
  httpStatus: number;
  payload: Record<string, unknown>;
};

/**
 * Shared repair pass for the dedicated cron route and nighthawk-morning-confirm
 * (which is scheduled in prod even when the backfill-repair EventBridge rule is missing).
 */
export async function runNighthawkBackfillRepairJob(opts: {
  started: number;
  editionDateParam: string;
  force: boolean;
  /** When true, skip the 9:00 ET window gate (morning-confirm already runs inside pre-open). */
  skipWindowGate?: boolean;
  delegatedFrom?: string;
}): Promise<NighthawkBackfillRepairJobResult> {
  const { started, editionDateParam, force, skipWindowGate, delegatedFrom } = opts;
  const today = todayEt(new Date(started));
  const tag = (payload: Record<string, unknown>) =>
    delegatedFrom ? { ...payload, delegated_from: delegatedFrom } : payload;

  if (!force && !isTradingDayEt(today)) {
    const payload = tag({ ok: true, skipped: true, reason: `non-trading day (${today})` });
    await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
    return { httpStatus: 200, payload };
  }

  if (!skipWindowGate && !inNighthawkBackfillRepairWindow(force)) {
    const payload = tag({
      ok: false,
      skipped: true,
      reason: "Outside repair window (9:00 AM ET) — use ?force=1 to override",
    });
    await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
    return { httpStatus: 200, payload };
  }

  try {
    let editionRow = await fetchNighthawkEditionByDate(editionDateParam);
    if (!editionRow) {
      editionRow = await fetchLatestNighthawkEdition();
    }
    if (!editionRow) {
      const payload = tag({ ok: false, skipped: true, reason: "No Night Hawk edition found to repair" });
      await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
      return { httpStatus: 200, payload };
    }

    const edition = rowToNightHawkEdition(editionRow);
    const editionFor = edition.edition_for ?? editionDateParam;

    if (!force && editionFor !== today) {
      const payload = tag({
        ok: true,
        skipped: true,
        reason: `Edition targets ${editionFor}, not today (${today}) — nothing to repair this session`,
      });
      await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
      return { httpStatus: 200, payload };
    }

    const result = await republishBackfilledEdition(editionFor);

    if (!result.ok) {
      if (result.status === "no_rank_governor_snapshot") {
        const dispatchRebuild = () => {
          void runWithBackgroundUwSweep(() =>
            buildEveningEdition({ asOfEt: previousTradingDayEt(editionFor), force: true, persist: true })
          )
            .then((rebuildResult) => {
              console.info("[nighthawk/backfill-repair] morning rescue rebuild done", {
                editionFor: sanitizeForLog(editionFor),
                plays: rebuildResult.plays_count,
                recapOnly: rebuildResult.recap_only ?? "?",
              });
            })
            .catch((err) => {
              console.error("[nighthawk/backfill-repair] morning rescue rebuild REJECTED", {
                editionFor: sanitizeForLog(editionFor),
                err,
              });
            });
        };
        try {
          after(dispatchRebuild);
        } catch {
          dispatchRebuild();
        }

        await notifyOpsDiscord({
          severity: "warning",
          title: `Night Hawk: morning rescue rebuild dispatched — ${editionFor}`,
          body:
            `No rank_governor snapshot for ${editionFor} (100% dossier-fetch collapse overnight) ` +
            `— dispatching one more full pipeline rebuild before market open.`,
        }).catch(() => undefined);

        const payload = tag({
          ok: true,
          status: "rebuild_dispatched",
          reason: "no_rank_governor_snapshot",
          edition_for: editionFor,
        });
        await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
        return { httpStatus: 200, payload };
      }

      const payload = tag({ ok: false, skipped: true, reason: result.status, edition_for: editionFor });
      await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
      return { httpStatus: 200, payload };
    }

    const repairedTickers = "repairedTickers" in result ? result.repairedTickers : [];
    const droppedTickers = "droppedTickers" in result ? result.droppedTickers : [];

    if (repairedTickers.length > 0 || droppedTickers.length > 0) {
      await notifyOpsDiscord({
        severity: "warning",
        title: `Night Hawk: stale BACKFILL contract self-healed — ${editionFor}`,
        body:
          `repaired: ${repairedTickers.join(", ") || "(none)"}\n` +
          `dropped: ${droppedTickers.join(", ") || "(none)"}\n` +
          `status=${result.status}`,
      }).catch(() => undefined);
    }

    const payload = tag({
      ok: true,
      edition_for: editionFor,
      status: result.status,
      plays_count: result.playsCount,
      repaired_tickers: repairedTickers,
      dropped_tickers: droppedTickers,
    });
    await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
    return { httpStatus: 200, payload };
  } catch (err) {
    const payload = tag({ ok: false, error: err instanceof Error ? err.message : String(err) });
    await logCronRun(NIGHTHAWK_BACKFILL_REPAIR_CRON_KEY, started, payload);
    return { httpStatus: 500, payload };
  }
}
