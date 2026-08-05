/**
 * Cron: post a live Thermal triple-desk snapshot (SPY | SPX | QQQ) to Discord.
 *
 * CACHE-READER: reads shared `fetchGexHeatmap` snapshots only — no per-request upstream.
 * INERT unless `DISCORD_THERMAL_WEBHOOK_URL` is set.
 *
 * **Cash RTH by default** — scheduled snapshots + breach polling. After close, EOD recap only
 * (`isThermalEodRecapDue`). Set `THERMAL_DISCORD_RTH_ONLY=0` to opt into 24/7 snapshots.
 *
 * **Cadence (every 15m):**
 * - :00 / :30 → full snapshot (embed + matrix PNG + shift leaders)
 * - :15 / :45 → pulse (embed only) when wall strikes quiet; upgrades to full if walls moved
 *
 * **Event-driven breaches (SPY · SPX · QQQ):**
 * - Flip / call wall / put wall crosses vs prior spot snapshot
 * - Per-ticker+kind side dedup (no repeat while holding same side)
 * - 5m poller: `?breach_only=1` (see `railway.thermal-discord-breach.toml`)
 *
 * **Session close (~4:05 PM ET):** one recap embed per session day.
 *
 * Schedule catalog: `railway.thermal-discord.toml` → EventBridge must be synced to fire.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { redactWebhook } from "@/lib/discord-post";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";
import {
  THERMAL_DISCORD_TICKERS,
  deskMonoFontFaceCss,
  type ThermalCardColumn,
} from "@/lib/thermal-discord-card";
import { isThermalEodRecapDue } from "@/lib/thermal-discord-eod";
import {
  runThermalBreachAlerts,
  runThermalEodRecap,
  runThermalScheduledPost,
} from "@/lib/thermal-discord-run";
import {
  THERMAL_DISCORD_DEDUP_KEY,
  THERMAL_DISCORD_DEDUP_TTL_SEC,
  thermalDiscordBypassesDedup,
} from "./thermal-discord-dedup";
import { thermalDiscordRthOnly } from "./thermal-discord-rth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function thermalWebhook(): string | null {
  return process.env.DISCORD_THERMAL_WEBHOOK_URL?.trim() || null;
}

async function fetchThermalColumns(): Promise<ThermalCardColumn[]> {
  const columns: ThermalCardColumn[] = [];
  for (const ticker of THERMAL_DISCORD_TICKERS) {
    const heatmap = await fetchGexHeatmap(ticker);
    columns.push({ ticker, heatmap });
  }
  return columns;
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
  const forceFull = req.nextUrl.searchParams.get("full") === "1";
  const allowDup = req.nextUrl.searchParams.get("allow_dup") === "1";
  const breachOnly = req.nextUrl.searchParams.get("breach_only") === "1";
  const bypassDedup = thermalDiscordBypassesDedup(force, allowDup);
  const now = new Date();

  const isRth = isEtCashRth(now);
  const eodDue = isThermalEodRecapDue(now);

  if (!force && thermalDiscordRthOnly() && !isRth && !eodDue) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside cash RTH / EOD window — Thermal Discord is RTH-only by default",
    };
    await logCronRun("thermal-discord", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const columns = await fetchThermalColumns();
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

    // ── Breaches: SPY + SPX + QQQ (every RTH tick; 5m poller uses breach_only=1) ──
    let breachResult = { seeded: false, detected: 0, posted: 0, tickers: [] as string[] };
    if (isRth || force) {
      breachResult = await runThermalBreachAlerts(webhook, columns);
    }

    if (breachOnly) {
      const payload = {
        ok: true,
        breach_only: true,
        ...breachResult,
        available,
        host: redactWebhook(webhook),
      };
      await logCronRun("thermal-discord", started, payload);
      return NextResponse.json(payload);
    }

    // ── Session close recap (after 4:00 PM ET, once per session) ──
    const eod = await runThermalEodRecap(webhook, columns, { bypassDedup, now });
    if (eodDue && eod.claimed) {
      const payload = {
        ok: eod.delivered,
        delivered: eod.delivered,
        eod_recap: true,
        breaches: breachResult,
        available,
        host: redactWebhook(webhook),
      };
      await logCronRun("thermal-discord", started, payload);
      return NextResponse.json(payload, { status: eod.delivered ? 200 : 502 });
    }

    if (!isRth && !force) {
      const payload = {
        ok: true,
        skipped: true,
        reason: "EOD recap already posted or not due",
        eod,
        breaches: breachResult,
        host: redactWebhook(webhook),
      };
      await logCronRun("thermal-discord", started, payload);
      return NextResponse.json(payload);
    }

    // ── Scheduled snapshot (15m dedup) ──
    let heldClaim = false;
    if (!bypassDedup) {
      const claimed = await sharedCacheSetNx(
        THERMAL_DISCORD_DEDUP_KEY,
        { at: new Date().toISOString() },
        THERMAL_DISCORD_DEDUP_TTL_SEC
      );
      if (!claimed) {
        const payload = {
          ok: true,
          skipped: true,
          reason: "deduped — scheduled post already sent within ~15m",
          breaches: breachResult,
          host: redactWebhook(webhook),
        };
        await logCronRun("thermal-discord", started, payload);
        return NextResponse.json(payload);
      }
      heldClaim = true;
    }

    const scheduled = await runThermalScheduledPost(webhook, columns, { forceFull, now });
    if (!scheduled.delivered && heldClaim) {
      await sharedCacheDel(THERMAL_DISCORD_DEDUP_KEY);
    }

    const payload = {
      ok: scheduled.delivered,
      delivered: scheduled.delivered,
      mode: scheduled.mode,
      breaches: breachResult,
      available,
      tickers: THERMAL_DISCORD_TICKERS,
      bytes: scheduled.bytes,
      font_embedded: scheduled.mode === "full" ? deskMonoFontFaceCss().includes("base64") : undefined,
      host: redactWebhook(webhook),
    };
    await logCronRun("thermal-discord", started, payload);
    return NextResponse.json(payload, { status: scheduled.delivered ? 200 : 502 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await logCronRun("thermal-discord", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "thermal-discord failed" }, { status: 500 });
  }
}
