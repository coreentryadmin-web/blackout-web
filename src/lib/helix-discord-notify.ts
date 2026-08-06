/**
 * Fire-and-forget HELIX Discord community alert for a freshly persisted flow.
 * Applies filters, RTH gate, milestone gate, burst collapse, best-effort GEX enrich.
 */
import { postDiscordWebhook } from "@/lib/discord-post";
import {
  buildHelixBurstEmbed,
  buildHelixDiscordEmbed,
  classifyHelixDiscordKind,
  contractStackHitsFromFlows,
  HELIX_DISCORD_MAX_DTE,
  HELIX_DISCORD_MIN_PREMIUM,
  helixDiscordAlertsEnabled,
  helixDiscordLiveRthOnly,
  helixDiscordWebhookUrl,
  passesHelixDiscordFilters,
  type HelixDiscordFlowInput,
} from "@/lib/helix-discord-format";
import { discordBurstWindowSec, ingestDiscordBurst } from "@/lib/discord-burst-buffer";
import { formatGexContextLine } from "@/lib/discord-context-enrichment";
import { enrichFlowWithGex } from "@/lib/flow-gex-proximity";
import { getGexLevelsForTicker } from "@/lib/flow-gex-enrichment";
import { isHelixRepeatFlow, resolveHelixMilestoneGate } from "@/lib/helix-discord-milestone";
import { isEtCashRth } from "@/lib/et-market-hours";
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
    kind === "stack" || isHelixRepeatFlow(flow);
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

async function enrichGexContext(flow: HelixDiscordFlowInput): Promise<HelixDiscordFlowInput> {
  let enriched = flow;
  try {
    if (flow.ticker && Number.isFinite(flow.strike)) {
      const levels = await getGexLevelsForTicker(flow.ticker);
      if (levels) {
        enriched = enrichFlowWithGex(flow, levels);
        const gex_context_line = formatGexContextLine(flow.strike, levels);
        if (gex_context_line) enriched = { ...enriched, gex_context_line };
      }
    }
  } catch {
    // GEX is optional.
  }
  return enriched;
}

async function postHelixFlows(flows: HelixDiscordFlowInput[], ticker: string): Promise<boolean> {
  const url = helixDiscordWebhookUrl();
  if (!url || !flows.length) return false;
  const windowMin = Math.round(discordBurstWindowSec() / 60);

  if (flows.length === 1) {
    const embed = buildHelixDiscordEmbed(flows[0]!);
    return postDiscordWebhook(url, { embeds: [embed] }, "helix-flow");
  }

  const embed = buildHelixBurstEmbed({ ticker, flows, windowMin });
  return postDiscordWebhook(url, { embeds: [embed] }, "helix-burst");
}

/** Flush a burst window to Discord (cron + rolled ingest). Exported for cron flush. */
export async function deliverHelixBurstItems(
  ticker: string,
  flows: HelixDiscordFlowInput[]
): Promise<boolean> {
  if (!helixDiscordAlertsEnabled() || !helixDiscordWebhookUrl()) return false;
  const enriched: HelixDiscordFlowInput[] = [];
  for (const f of flows) {
    if (!passesHelixDiscordFilters(f)) continue;
    enriched.push(await enrichGexContext(f));
  }
  if (!enriched.length) return false;
  return postHelixFlows(enriched, ticker);
}

export async function notifyHelixDiscordFlow(flow: HelixDiscordFlowInput): Promise<boolean> {
  if (!helixDiscordAlertsEnabled()) return false;
  const url = helixDiscordWebhookUrl();
  if (!url) return false;
  if (helixDiscordLiveRthOnly() && !isEtCashRth()) return false;
  if (!passesHelixDiscordFilters(flow)) return false;

  let enriched = await enrichGexContext(flow);
  enriched = await enrichStackHits(enriched);
  if (!passesHelixDiscordFilters(enriched)) return false;

  const hitCount = Math.max(enriched.stack_hits?.length ?? 0, 1);
  const gate = await resolveHelixMilestoneGate(enriched, hitCount);
  if (!gate.post) return false;
  if (gate.milestone != null) {
    enriched = { ...enriched, stack_milestone: gate.milestone };
  }

  const { flush } = await ingestDiscordBurst("helix", enriched.ticker, enriched);
  if (flush?.length) {
    await deliverHelixBurstItems(enriched.ticker, flush);
  }
  return true;
}
