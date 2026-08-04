/**
 * Fire-and-forget HELIX Discord community alert for a freshly persisted flow.
 * Applies the 3 filters, best-effort GEX enrich, posts write-up embed.
 */
import { postDiscordWebhook } from "@/lib/discord-post";
import {
  buildHelixDiscordEmbed,
  classifyHelixDiscordKind,
  contractStackHitsFromFlows,
  HELIX_DISCORD_MAX_DTE,
  HELIX_DISCORD_MIN_PREMIUM,
  helixDiscordAlertsEnabled,
  helixDiscordWebhookUrl,
  passesHelixDiscordFilters,
  type HelixDiscordFlowInput,
} from "@/lib/helix-discord-format";
import { enrichFlowWithGex } from "@/lib/flow-gex-proximity";
import { getGexLevelsForTicker } from "@/lib/flow-gex-enrichment";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";

function flowRowToDiscordInput(row: {
  ticker: string;
  premium: number;
  option_type: string;
  expiry: string;
  strike: number;
  direction: string;
  score: number;
  route: string;
  alerted_at: string;
  event_at?: string | null;
  dte?: number;
  fill_price?: number;
  ask_pct?: number;
  open_interest?: number;
  otm_pct?: number;
  implied_volatility?: number;
  alert_rule?: string;
}): HelixDiscordFlowInput {
  return {
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

async function enrichStackHits(flow: HelixDiscordFlowInput): Promise<HelixDiscordFlowInput> {
  const kind = classifyHelixDiscordKind(flow);
  const isRepeat =
    kind === "stack" || /repeat/i.test(String(flow.alert_rule || ""));
  if (!isRepeat || !dbConfigured()) return flow;

  try {
    const rows = await fetchRecentFlows({
      ticker: flow.ticker,
      limit: 120,
      min_premium: HELIX_DISCORD_MIN_PREMIUM,
      max_dte: HELIX_DISCORD_MAX_DTE,
      since_hours: 6,
      order: "recent",
    });
    const pool = rows.map(flowRowToDiscordInput);
    const stack_hits = contractStackHitsFromFlows(flow, pool);
    if (stack_hits.length >= 2) return { ...flow, stack_hits };
  } catch {
    // Stack timeline is optional — still post the live print.
  }
  return flow;
}

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

  enriched = await enrichStackHits(enriched);

  // Re-check after enrich (enrich doesn't change filter fields, but keep fail-closed).
  if (!passesHelixDiscordFilters(enriched)) return false;

  const embed = buildHelixDiscordEmbed(enriched);
  return postDiscordWebhook(url, { embeds: [embed] }, "helix-flow");
}
