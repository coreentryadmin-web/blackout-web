/**
 * Fire-and-forget dark pool Discord alerts — RTH gate, burst collapse, ADV context, dedup.
 */
import { postDiscordWebhook } from "@/lib/discord-post";
import { sharedCacheSetNx } from "@/lib/shared-cache";
import { discordBurstWindowSec, ingestDiscordBurst } from "@/lib/discord-burst-buffer";
import {
  estimateDarkpoolShareSize,
  formatAdvContextLine,
  getTickerAdv20d,
} from "@/lib/discord-context-enrichment";
import { isEtCashRth } from "@/lib/et-market-hours";
import {
  buildDarkpoolBurstEmbed,
  buildDarkpoolDiscordEmbed,
  darkpoolDiscordAlertsEnabled,
  darkpoolDiscordDedupKey,
  darkpoolDiscordLiveRthOnly,
  darkpoolDiscordWebhookUrl,
  normalizeDarkPoolDiscordPrint,
  passesDarkpoolDiscordFilters,
  type DarkPoolDiscordPrint,
} from "@/lib/darkpool-discord-format";

const SEEN_TTL_SEC = 6 * 60 * 60;

function seenKey(print: DarkPoolDiscordPrint): string {
  return `darkpool-discord:seen:${darkpoolDiscordDedupKey(print)}`;
}

/** Claim dedup slot — true when this print has not been posted recently. */
export async function claimDarkpoolDiscordPrint(print: DarkPoolDiscordPrint): Promise<boolean> {
  return sharedCacheSetNx(seenKey(print), { at: new Date().toISOString() }, SEEN_TTL_SEC);
}

async function enrichAdvContext(print: DarkPoolDiscordPrint): Promise<DarkPoolDiscordPrint> {
  try {
    const adv = await getTickerAdv20d(print.ticker);
    const shares = estimateDarkpoolShareSize(print);
    const adv_context_line = formatAdvContextLine(shares, adv);
    if (adv_context_line) return { ...print, adv_context_line };
  } catch {
    // ADV line is optional.
  }
  return print;
}

async function postDarkpoolPrints(prints: DarkPoolDiscordPrint[], ticker: string): Promise<boolean> {
  const url = darkpoolDiscordWebhookUrl();
  if (!url || !prints.length) return false;
  const windowMin = Math.round(discordBurstWindowSec() / 60);

  if (prints.length === 1) {
    const embed = buildDarkpoolDiscordEmbed(prints[0]!);
    return postDiscordWebhook(url, { embeds: [embed] }, "darkpool-block");
  }

  const embed = buildDarkpoolBurstEmbed({ ticker, prints, windowMin });
  return postDiscordWebhook(url, { embeds: [embed] }, "darkpool-burst");
}

/** Flush a burst window to Discord (cron + rolled ingest). */
export async function deliverDarkpoolBurstItems(
  ticker: string,
  prints: DarkPoolDiscordPrint[]
): Promise<boolean> {
  if (!darkpoolDiscordAlertsEnabled() || !darkpoolDiscordWebhookUrl()) return false;
  const enriched: DarkPoolDiscordPrint[] = [];
  for (const p of prints) {
    if (!passesDarkpoolDiscordFilters(p)) continue;
    enriched.push(await enrichAdvContext(p));
  }
  if (!enriched.length) return false;
  return postDarkpoolPrints(enriched, ticker);
}

export async function notifyDarkpoolDiscordPrint(print: DarkPoolDiscordPrint): Promise<boolean> {
  if (!darkpoolDiscordAlertsEnabled()) return false;
  const url = darkpoolDiscordWebhookUrl();
  if (!url) return false;
  if (darkpoolDiscordLiveRthOnly() && !isEtCashRth()) return false;
  if (!passesDarkpoolDiscordFilters(print)) return false;

  const claimed = await claimDarkpoolDiscordPrint(print);
  if (!claimed) return false;

  const enriched = await enrichAdvContext(print);
  const { flush } = await ingestDiscordBurst("darkpool", enriched.ticker, enriched);
  if (flush?.length) {
    await deliverDarkpoolBurstItems(enriched.ticker, flush);
  }
  return true;
}

export async function notifyDarkpoolDiscordPrints(prints: readonly DarkPoolDiscordPrint[]): Promise<number> {
  let posted = 0;
  for (const print of prints) {
    if (!passesDarkpoolDiscordFilters(print)) continue;
    try {
      if (await notifyDarkpoolDiscordPrint(print)) posted++;
    } catch {
      /* fail-soft per print */
    }
  }
  return posted;
}

/** Cache-reader scan — normalize UW recent rows and post any new qualifying blocks. */
export async function scanDarkpoolDiscordFromCache(limit = 80): Promise<number> {
  if (!darkpoolDiscordAlertsEnabled() || !darkpoolDiscordWebhookUrl()) return 0;

  const { fetchUwDarkPoolRecent } = await import("@/lib/providers/unusual-whales");
  const rawRows = await fetchUwDarkPoolRecent(limit);
  const prints = (Array.isArray(rawRows) ? rawRows : [])
    .map(normalizeDarkPoolDiscordPrint)
    .filter((p): p is DarkPoolDiscordPrint => p != null);

  return notifyDarkpoolDiscordPrints(prints);
}
