/**
 * Fire-and-forget HELIX Discord community alert for a freshly persisted flow.
 * Applies the 3 filters, best-effort GEX enrich, posts write-up embed.
 */
import { postDiscordWebhook } from "@/lib/discord-post";
import {
  buildHelixDiscordEmbed,
  helixDiscordAlertsEnabled,
  helixDiscordWebhookUrl,
  passesHelixDiscordFilters,
  type HelixDiscordFlowInput,
} from "@/lib/helix-discord-format";
import { enrichFlowWithGex } from "@/lib/flow-gex-proximity";
import { getGexLevelsForTicker } from "@/lib/flow-gex-enrichment";

export async function notifyHelixDiscordFlow(flow: HelixDiscordFlowInput): Promise<boolean> {
  if (!helixDiscordAlertsEnabled()) return false;
  const url = helixDiscordWebhookUrl();
  if (!url) return false;
  if (!passesHelixDiscordFilters(flow)) return false;

  let enriched: HelixDiscordFlowInput = flow;
  try {
    if (flow.ticker && Number.isFinite(flow.strike)) {
      const levels = await getGexLevelsForTicker(flow.ticker);
      if (levels) enriched = enrichFlowWithGex(flow, levels);
    }
  } catch {
    // GEX is optional — still post the write-up without walls.
  }

  // Re-check after enrich (enrich doesn't change filter fields, but keep fail-closed).
  if (!passesHelixDiscordFilters(enriched)) return false;

  const embed = buildHelixDiscordEmbed(enriched);
  return postDiscordWebhook(url, { embeds: [embed] }, "helix-flow");
}
