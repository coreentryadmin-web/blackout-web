/**
 * Cron: HELIX community Discord digests (top hits last 15m / 30m).
 *
 * Posts to `DISCORD_HELIX_WEBHOOK_URL`. Opt-in via `HELIX_DISCORD_ALERTS=1`.
 * `HELIX_DISCORD_ALERTS=1`. Applies the three live filters (≥$500K · fill <$10 ·
 * ≤30 DTE), ranks like the HELIX desk rail (score≥5 then premium).
 *
 * CACHE-READER: Postgres `fetchRecentFlows` only — no per-request UW calls.
 * GEX proximity is best-effort enrich from shared heatmap cache.
 *
 * Dedup: Redis NX `helix-discord-digest:15m` / `:30m` (~14m / ~28m) so overlapping
 * EventBridge ticks cannot flood. Bypass with `?force=1&allow_dup=1`.
 *
 * Schedule catalog: `railway.helix-discord-digest.toml` — EventBridge must be synced.
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { dbConfigured, fetchRecentFlows, type FlowRow } from "@/lib/db";
import { postDiscordWebhook, redactWebhook } from "@/lib/discord-post";
import { enrichFlowsWithGex } from "@/lib/flow-gex-enrichment";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";
import {
  HELIX_DISCORD_DIGEST_LIMIT,
  HELIX_DISCORD_MAX_DTE,
  HELIX_DISCORD_MIN_PREMIUM,
  buildHelixStackedHitsDigestEmbed,
  buildHelixTopHitsDigestEmbed,
  helixDiscordAlertsEnabled,
  helixDiscordWebhookUrl,
  selectHelixDiscordDigest,
  selectHelixDiscordStacks,
  passesHelixDiscordFilters,
  type HelixDiscordFlowInput,
} from "@/lib/helix-discord-format";
import { HELIX_STRIKE_HITS_WINDOW_MIN } from "@/features/helix/lib/helix-strike-leaders";
import { flushStaleDiscordBursts } from "@/lib/discord-burst-buffer";
import {
  buildHelixEodRecapEmbed,
  claimDiscordEodRecap,
  currentSessionDateEt,
  isDiscordEodRecapWindow,
} from "@/lib/discord-eod-recap";
import { deliverHelixBurstItems } from "@/lib/helix-discord-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEDUP_15_KEY = "helix-discord-digest:15m";
const DEDUP_30_KEY = "helix-discord-digest:30m";
const DEDUP_15_TTL_SEC = 14 * 60;
const DEDUP_30_TTL_SEC = 28 * 60;

function rthOnly(): boolean {
  const v = process.env.HELIX_DISCORD_DIGEST_RTH_ONLY?.trim().toLowerCase();
  // Default ON — digests are an RTH tape product.
  if (v == null || v === "") return true;
  return v === "1" || v === "true" || v === "yes";
}

function toInput(row: FlowRow): HelixDiscordFlowInput {
  return {
    alert_id: row.alert_id ?? null,
    ticker: row.ticker,
    premium: row.premium,
    option_type: row.option_type,
    expiry: row.expiry,
    strike: row.strike,
    direction: row.direction,
    score: row.score,
    route: row.route,
    alerted_at: row.alerted_at || null,
    event_at: row.event_at ?? null,
    dte: row.dte ?? null,
    fill_price: row.fill_price ?? null,
    ask_pct: row.ask_pct ?? null,
    open_interest: row.open_interest ?? null,
    otm_pct: row.otm_pct ?? null,
    implied_volatility: row.implied_volatility ?? null,
    alert_rule: row.alert_rule ?? null,
  };
}

async function claimDedup(
  key: string,
  ttl: number,
  bypass: boolean
): Promise<{ claimed: boolean; held: boolean }> {
  if (bypass) return { claimed: true, held: false };
  const claimed = await sharedCacheSetNx(key, { at: new Date().toISOString() }, ttl);
  return { claimed, held: claimed };
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!helixDiscordAlertsEnabled()) {
    const payload = { ok: true, inert: true, reason: "HELIX_DISCORD_ALERTS unset" };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload);
  }

  const webhook = helixDiscordWebhookUrl();
  if (!webhook) {
    const payload = {
      ok: true,
      inert: true,
      reason: "DISCORD_HELIX_WEBHOOK_URL unset",
    };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload);
  }

  if (!dbConfigured()) {
    const payload = { ok: true, skipped: true, reason: "DATABASE_URL unset" };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const allowDup = req.nextUrl.searchParams.get("allow_dup") === "1";
  const bypassDedup = force && allowDup;

  if (!force && rthOnly() && !isEtCashRth()) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "Outside cash RTH (HELIX_DISCORD_DIGEST_RTH_ONLY)",
    };
    await logCronRun("helix-discord-digest", started, payload);
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
  // Every tick posts 15m; :00/:30 (and force) also post 30m.
  const want30 = force || minute === 0 || minute === 30;

  const claim15 = await claimDedup(DEDUP_15_KEY, DEDUP_15_TTL_SEC, bypassDedup);
  if (!claim15.claimed) {
    const payload = {
      ok: true,
      skipped: true,
      reason: "deduped — 15m digest already posted within ~15m",
      host: redactWebhook(webhook),
    };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload);
  }

  let claim30Held = false;
  let postedEod = false;
  try {
    // Pull enough recent whale-tier candidates; fill filter applied in selectHelixDiscordDigest.
    const rows = await fetchRecentFlows({
      limit: 400,
      min_premium: HELIX_DISCORD_MIN_PREMIUM,
      max_dte: HELIX_DISCORD_MAX_DTE,
      since_hours: 6,
      order: "recent",
    });
    const inputs = rows.map(toInput);

    const digest15 = selectHelixDiscordDigest(inputs, {
      windowMin: 15,
      now,
      limit: HELIX_DISCORD_DIGEST_LIMIT,
    });
    const stacks15 = selectHelixDiscordStacks(inputs, {
      windowMin: HELIX_STRIKE_HITS_WINDOW_MIN,
      now,
      limit: HELIX_DISCORD_DIGEST_LIMIT,
    });

    async function withGex(selected: HelixDiscordFlowInput[]): Promise<HelixDiscordFlowInput[]> {
      if (!selected.length) return selected;
      try {
        return await enrichFlowsWithGex(selected, selected.length);
      } catch {
        return selected;
      }
    }

    // Skip quiet empty digests unless force — avoid spamming "Quiet tape" every 15m.
    const post15 = force || digest15.rows.length > 0;
    const postStacks15 = force || stacks15.length > 0;
    let delivered15 = false;
    if (post15 || postStacks15) {
      const embeds = [];
      if (post15) {
        embeds.push(
          buildHelixTopHitsDigestEmbed({
            windowMin: 15,
            rows: await withGex(digest15.rows),
            inWindowCount: digest15.inWindowCount,
            sessionFallback: digest15.sessionFallback,
            now,
          })
        );
      }
      if (postStacks15) {
        embeds.push(
          buildHelixStackedHitsDigestEmbed({
            windowMin: HELIX_STRIKE_HITS_WINDOW_MIN,
            stacks: stacks15,
            now,
          })
        );
      }
      delivered15 = await postDiscordWebhook(webhook, { embeds }, "helix-digest-15m");
      if (!delivered15 && claim15.held) {
        await sharedCacheDel(DEDUP_15_KEY);
      }
    } else if (claim15.held) {
      // Nothing to post — release claim so a later tick with prints can fire.
      await sharedCacheDel(DEDUP_15_KEY);
    }

    let delivered30: boolean | null = null;
    let digest30Summary: { inWindowCount: number; rows: number; sessionFallback: boolean } | null =
      null;
    if (want30) {
      const claim30 = await claimDedup(DEDUP_30_KEY, DEDUP_30_TTL_SEC, bypassDedup);
      claim30Held = claim30.held;
      if (claim30.claimed) {
        const digest30 = selectHelixDiscordDigest(inputs, {
          windowMin: 30,
          now,
          limit: HELIX_DISCORD_DIGEST_LIMIT,
        });
        const stacks30 = selectHelixDiscordStacks(inputs, {
          windowMin: 30,
          now,
          limit: HELIX_DISCORD_DIGEST_LIMIT,
        });
        digest30Summary = {
          inWindowCount: digest30.inWindowCount,
          rows: digest30.rows.length,
          sessionFallback: digest30.sessionFallback,
        };
        const post30 = force || digest30.rows.length > 0;
        const postStacks30 = force || stacks30.length > 0;
        if (post30 || postStacks30) {
          const embeds = [];
          if (post30) {
            embeds.push(
              buildHelixTopHitsDigestEmbed({
                windowMin: 30,
                rows: await withGex(digest30.rows),
                inWindowCount: digest30.inWindowCount,
                sessionFallback: digest30.sessionFallback,
                now,
              })
            );
          }
          if (postStacks30) {
            embeds.push(
              buildHelixStackedHitsDigestEmbed({
                windowMin: 30,
                stacks: stacks30,
                now,
              })
            );
          }
          delivered30 = await postDiscordWebhook(
            webhook,
            { embeds },
            "helix-digest-30m"
          );
          if (!delivered30 && claim30.held) await sharedCacheDel(DEDUP_30_KEY);
        } else if (claim30.held) {
          await sharedCacheDel(DEDUP_30_KEY);
          claim30Held = false;
        }
      }
    }

    const staleBursts = await flushStaleDiscordBursts<HelixDiscordFlowInput>("helix", now);
    let flushedBursts = 0;
    for (const burst of staleBursts) {
      if (await deliverHelixBurstItems(burst.ticker, burst.items)) flushedBursts++;
    }

    if (isDiscordEodRecapWindow(now)) {
      const sessionDate = currentSessionDateEt(now);
      const eodClaimed = await claimDiscordEodRecap("helix", sessionDate, bypassDedup);
      if (eodClaimed) {
        const sessionFlows = inputs.filter((f) => passesHelixDiscordFilters(f, now));
        const eodEmbed = buildHelixEodRecapEmbed({
          flows: sessionFlows,
          sessionDate,
          now,
        });
        postedEod = await postDiscordWebhook(webhook, { embeds: [eodEmbed] }, "helix-eod-recap");
      }
    }

    const payload = {
      ok: true,
      host: redactWebhook(webhook),
      posted_15m: delivered15,
      posted_30m: delivered30,
      posted_eod: postedEod,
      flushed_bursts: flushedBursts,
      digest_15: {
        inWindowCount: digest15.inWindowCount,
        rows: digest15.rows.length,
        sessionFallback: digest15.sessionFallback,
        stacks: stacks15.length,
      },
      digest_30: digest30Summary,
    };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    if (claim15.held) await sharedCacheDel(DEDUP_15_KEY);
    if (claim30Held) await sharedCacheDel(DEDUP_30_KEY);
    const payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    await logCronRun("helix-discord-digest", started, payload);
    return NextResponse.json(payload, { status: 500 });
  }
}
