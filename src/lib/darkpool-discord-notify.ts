/**
 * Fire-and-forget dark pool Discord alerts — deduped via Redis NX.
 */
import { postDiscordWebhook } from "@/lib/discord-post";
import { sharedCacheSetNx } from "@/lib/shared-cache";
import {
  buildDarkpoolDiscordEmbed,
  darkpoolDiscordAlertsEnabled,
  darkpoolDiscordDedupKey,
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

export async function notifyDarkpoolDiscordPrint(print: DarkPoolDiscordPrint): Promise<boolean> {
  if (!darkpoolDiscordAlertsEnabled()) return false;
  const url = darkpoolDiscordWebhookUrl();
  if (!url) return false;
  if (!passesDarkpoolDiscordFilters(print)) return false;

  const claimed = await claimDarkpoolDiscordPrint(print);
  if (!claimed) return false;

  const embed = buildDarkpoolDiscordEmbed(print);
  const ok = await postDiscordWebhook(url, { embeds: [embed] }, "darkpool-block");
  return ok;
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
