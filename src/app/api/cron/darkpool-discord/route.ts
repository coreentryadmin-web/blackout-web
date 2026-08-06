/**
 * Cron: Dark pool Discord alerts (#blackout-darkpool).
 *
 * Every tick: scan cached market-wide dark pool prints, post new blocks (Redis dedup).
 * Every 15m (:00/:15:…): top-blocks digest embed.
 *
 * CACHE-READER: fetchUwDarkPoolRecent (Redis / WS-backed) — no per-tick UW REST when fresh.
 * Opt-in: DARKPOOL_DISCORD_ALERTS=1 + DISCORD_DARKPOOL_WEBHOOK_URL.
 *
 * Schedule catalog: railway.darkpool-discord.toml — EventBridge must be synced.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { postDiscordWebhook, redactWebhook } from "@/lib/discord-post";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";
import {
  buildDarkpoolTopBlocksDigestEmbed,
  darkpoolDiscordAlertsEnabled,
  darkpoolDiscordWebhookUrl,
  normalizeDarkPoolDiscordPrint,
  selectDarkpoolDigestPrints,
  type DarkPoolDiscordPrint,
} from "@/lib/darkpool-discord-format";
import { scanDarkpoolDiscordFromCache, deliverDarkpoolBurstItems } from "@/lib/darkpool-discord-notify";
import { flushStaleDiscordBursts } from "@/lib/discord-burst-buffer";
import {
  buildDarkpoolEodRecapEmbed,
  claimDiscordEodRecap,
  currentSessionDateEt,
  isDiscordEodRecapWindow,
} from "@/lib/discord-eod-recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEDUP_DIGEST_KEY = "darkpool-discord-digest:15m";
const DEDUP_DIGEST_TTL_SEC = 14 * 60;

function rthOnly(): boolean {
  const v = process.env.DARKPOOL_DISCORD_RTH_ONLY?.trim().toLowerCase();
  if (v == null || v === "") return true;
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!darkpoolDiscordAlertsEnabled()) {
    const payload = { ok: true, inert: true, reason: "DARKPOOL_DISCORD_ALERTS unset" };
    await logCronRun("darkpool-discord", started, payload);
    return NextResponse.json(payload);
  }

  const webhook = darkpoolDiscordWebhookUrl();
  if (!webhook) {
    const payload = { ok: true, inert: true, reason: "DISCORD_DARKPOOL_WEBHOOK_URL unset" };
    await logCronRun("darkpool-discord", started, payload);
    return NextResponse.json(payload);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const allowDup = req.nextUrl.searchParams.get("allow_dup") === "1";
  const bypassDedup = force && allowDup;

  if (!force && rthOnly() && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("darkpool-discord", started, payload);
    return NextResponse.json(payload);
  }

  const now = new Date();
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      minute: "numeric",
      hour12: false,
    }).format(now)
  );
  const wantDigest = force || minute % 15 === 0;

  try {
    const postedLive = await scanDarkpoolDiscordFromCache(100);

    const staleBursts = await flushStaleDiscordBursts<DarkPoolDiscordPrint>("darkpool", now);
    let flushedBursts = 0;
    for (const burst of staleBursts) {
      if (await deliverDarkpoolBurstItems(burst.ticker, burst.items)) flushedBursts++;
    }

    let postedEod = false;
    if (isDiscordEodRecapWindow(now)) {
      const sessionDate = currentSessionDateEt(now);
      const eodClaimed = await claimDiscordEodRecap("darkpool", sessionDate, bypassDedup);
      if (eodClaimed) {
        const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
        const rawRows = await fetchUwDarkPoolRecent(200);
        const sessionPrints: DarkPoolDiscordPrint[] = (Array.isArray(rawRows) ? rawRows : [])
          .map(normalizeDarkPoolDiscordPrint)
          .filter((p): p is DarkPoolDiscordPrint => p != null);
        const eodEmbed = buildDarkpoolEodRecapEmbed({
          prints: sessionPrints,
          sessionDate,
          now,
        });
        postedEod = await postDiscordWebhook(webhook, { embeds: [eodEmbed] }, "darkpool-eod-recap");
      }
    }

    let postedDigest = false;
    let digestSummary: { inWindowCount: number; rows: number } | null = null;

    if (wantDigest) {
      const claimed = bypassDedup
        ? true
        : await sharedCacheSetNx(DEDUP_DIGEST_KEY, { at: now.toISOString() }, DEDUP_DIGEST_TTL_SEC);
      if (claimed) {
        const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
        const rawRows = await fetchUwDarkPoolRecent(100);
        const prints: DarkPoolDiscordPrint[] = (Array.isArray(rawRows) ? rawRows : [])
          .map(normalizeDarkPoolDiscordPrint)
          .filter((p): p is DarkPoolDiscordPrint => p != null);

        const digest = selectDarkpoolDigestPrints(prints, { windowMin: 15, now });
        digestSummary = { inWindowCount: digest.inWindowCount, rows: digest.rows.length };

        if (force || digest.rows.length > 0) {
          const embed = buildDarkpoolTopBlocksDigestEmbed({
            windowMin: 15,
            rows: digest.rows,
            inWindowCount: digest.inWindowCount,
            now,
          });
          postedDigest = await postDiscordWebhook(webhook, { embeds: [embed] }, "darkpool-digest-15m");
          if (!postedDigest && !bypassDedup) await sharedCacheDel(DEDUP_DIGEST_KEY);
        } else if (!bypassDedup) {
          await sharedCacheDel(DEDUP_DIGEST_KEY);
        }
      }
    }

    const payload = {
      ok: true,
      host: redactWebhook(webhook),
      posted_live: postedLive,
      posted_digest: postedDigest,
      posted_eod: postedEod,
      flushed_bursts: flushedBursts,
      digest: digestSummary,
    };
    await logCronRun("darkpool-discord", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    await logCronRun("darkpool-discord", started, payload);
    return NextResponse.json(payload, { status: 500 });
  }
}
