/**
 * Cron: post a live Thermal triple-desk PNG (SPY | SPX | QQQ) to Discord.
 *
 * CACHE-READER: reads shared `fetchGexHeatmap` snapshots only — no per-request upstream.
 * INERT unless `DISCORD_THERMAL_WEBHOOK_URL` is set.
 *
 * Runs 24/7 by default (preview / off-hours snapshots still useful). Set
 * `THERMAL_DISCORD_RTH_ONLY=1` to skip outside cash RTH (unless `?force=1`).
 *
 * Schedule catalog: `railway.thermal-discord.toml` → EventBridge must be synced to fire.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { postDiscordWebhookWithFiles, redactWebhook } from "@/lib/discord-post";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import {
  THERMAL_DISCORD_TICKERS,
  renderThermalDiscordCardPng,
  thermalDiscordCaption,
  type ThermalCardColumn,
} from "@/lib/thermal-discord-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function thermalWebhook(): string | null {
  return process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim() || null;
}

function rthOnly(): boolean {
  const v = process.env.THERMAL_DISCORD_RTH_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhook = thermalWebhook();
  if (!webhook) {
    const payload = {
      ok: true,
      inert: true,
      reason: "DISCORD_THERMAL_WEBHOOK_URL unset",
    };
    await logCronRun("thermal-discord", started, payload);
    return NextResponse.json(payload);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && rthOnly() && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH (THERMAL_DISCORD_RTH_ONLY)" };
    await logCronRun("thermal-discord", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const columns: ThermalCardColumn[] = [];
    for (const ticker of THERMAL_DISCORD_TICKERS) {
      const heatmap = await fetchGexHeatmap(ticker);
      columns.push({ ticker, heatmap });
    }

    const available = columns.filter((c) => c.heatmap != null).length;
    if (available === 0) {
      const payload = {
        ok: true,
        skipped: true,
        reason: "No heatmap snapshots available",
        host: redactWebhook(webhook),
      };
      await logCronRun("thermal-discord", started, payload);
      return NextResponse.json(payload);
    }

    const png = await renderThermalDiscordCardPng(columns);
    const content = thermalDiscordCaption(columns);
    const delivered = await postDiscordWebhookWithFiles(
      webhook,
      { content },
      [{ filename: "thermal-desk.png", bytes: png, contentType: "image/png" }],
      "thermal-desk"
    );

    const payload = {
      ok: delivered,
      delivered,
      available,
      tickers: THERMAL_DISCORD_TICKERS,
      bytes: png.byteLength,
      host: redactWebhook(webhook),
    };
    await logCronRun("thermal-discord", started, payload);
    return NextResponse.json(payload, { status: delivered ? 200 : 502 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("thermal-discord", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "thermal-discord failed" }, { status: 500 });
  }
}
