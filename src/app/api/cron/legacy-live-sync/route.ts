// Cron: Legacy live-sync — mark-and-manage open Night Hawk playbook positions for the Chief Trade Alert Bot.
//
// SCHEDULE: piggybacks on the banger-live-sync cadence (~every 5 min RTH) until dedicated
// EventBridge wiring lands. Kill-switch is LEGACY_DISCORD_ALERTS — when off, rows are untouched.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import {
  fetchLegacyDiscordLiveRows,
  updateLegacyDiscordLiveState,
  type LegacyDiscordLiveRow,
} from "@/lib/db";
import { fetchStockSnapshots } from "@/lib/providers/polygon";
import { fetchLegacyOptionMarksServer } from "@/features/nighthawk/lib/legacy-option-marks-server";
import { hydrateLegacyLiveSyncRow, runLegacyLiveSync } from "@/features/nighthawk/lib/legacy-live-sync";
import {
  legacyInputFromLiveRow,
  notifyLegacyScaleOutPartial,
  notifyLegacyTradeClose,
  notifyLegacyTradeTrimLatch,
} from "@/features/nighthawk/lib/legacy-discord-trade-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_KEY = "legacy-live-sync";

function discordInput(row: LegacyDiscordLiveRow) {
  const input = legacyInputFromLiveRow(row);
  if (!input) return null;
  const live = row.discord_live_state;
  return {
    ...input,
    last_mark: live?.last_mark ?? null,
    trims_taken: live?.trims_taken ?? 0,
  };
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLegacyLiveSync({
      fetchOpenRows: async () => {
        const rows = await fetchLegacyDiscordLiveRows();
        return rows.map(hydrateLegacyLiveSyncRow);
      },
      fetchOptionMarks: async (occs) => {
        const marks = await fetchLegacyOptionMarksServer(occs);
        const out = new Map<string, number>();
        for (const [occ, row] of marks) {
          if (row.mark != null) out.set(occ, row.mark);
        }
        return out;
      },
      fetchStockPrices: async (tickers) => {
        const snaps = await fetchStockSnapshots(tickers).catch(() => ({} as Record<string, { price: number } | null>));
        const out = new Map<string, number>();
        for (const [tk, snap] of Object.entries(snaps)) {
          const px = snap?.price ?? null;
          if (px != null && Number.isFinite(px) && px > 0) out.set(tk.toUpperCase(), px);
        }
        return out;
      },
      updateLiveState: updateLegacyDiscordLiveState,
      notifyTrimLatch: async (row, price) => {
        const input = discordInput(row);
        if (!input) return;
        await notifyLegacyTradeTrimLatch({ ...input, last_mark: price }, price);
      },
      notifyTrim: async (row, trimIndex, price) => {
        const input = discordInput(row);
        if (!input) return;
        await notifyLegacyScaleOutPartial({ ...input, last_mark: price }, trimIndex, price);
      },
      notifyClose: async (row, price, reason) => {
        const input = discordInput(row);
        if (!input) return;
        const suffix = reason.includes("invalidated")
          ? "stc:invalidated"
          : reason.includes("hard stop") || reason.includes("STOP_OUT")
            ? "stc:stop"
            : reason.includes("target") || reason.includes("EXIT_RUNNER")
              ? "stc:target"
              : "stc:live";
        await notifyLegacyTradeClose({ ...input, last_mark: price }, price, {
          idempotencySuffix: suffix,
        });
      },
    });

    await logCronRun(CRON_KEY, started, { ...result, duration_ms: Date.now() - started });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/legacy-live-sync]", error);
    await logCronRun(CRON_KEY, started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Legacy live-sync failed" }, { status: 500 });
  }
}
