import { anthropicConfigured, anthropicText } from "@/lib/providers/anthropic";
import { fetchTickerDossier } from "./dossier";
import { formatTickerDossierText } from "./format";
import type { PlaybookPlay } from "./types";
import { buildGroundedPlayExplanationFallback, playRiskLines } from "./play-explainer-fallback";
import { checkNumbersGrounded, extractNumbersFromText } from "@/lib/grounding-guard";

const SYSTEM = `You are Night Hawk — the evening playbook analyst for BlackOut Trading. A member clicked a ranked play and wants a thorough institutional-grade briefing on WHY it made tonight's top 5.

Rules:
- Use ONLY facts from the data block. Do not invent flow prints, levels, premiums, or catalysts.
- Be detailed and structured — this should read like a desk note, not a tweet.
- Use plain text with **Bold section headers** on their own line (no markdown tables or # headings).
- Cover every dimension present in the data; if a dimension is missing, say it was not in tonight's scan.
- End with **Bottom line:** — one paragraph on conviction and what would invalidate the setup tomorrow.

Required sections (include all that apply):
**Why ranked #N**
**Market & sector context**
**Options flow & strike activity**
**Positioning / GEX / max pain**
**Technicals & key levels**
**News & catalysts**
**The contract & premium**
**Entry · target · stop logic**
**Risks & invalidation**
**Bottom line:**`;

function formatMarketRecapBlock(recap: Record<string, unknown> | null | undefined): string {
  if (!recap) return "Market recap not available.";
  const lines: string[] = [];
  for (const key of [
    "tide",
    "spx_vix",
    "sector_strength",
    "sector_weakness",
    "catalysts",
  ] as const) {
    const v = recap[key];
    if (typeof v === "string" && v.trim()) lines.push(`${key}: ${v}`);
  }
  if (recap.vix_iv_rank != null) lines.push(`VIX IV rank: ${recap.vix_iv_rank}`);
  if (Array.isArray(recap.vix_term) && recap.vix_term.length) {
    lines.push(`VIX term: ${JSON.stringify(recap.vix_term).slice(0, 400)}`);
  }
  if (Array.isArray(recap.top_net_impact) && recap.top_net_impact.length) {
    lines.push(
      `Top net impact: ${recap.top_net_impact
        .slice(0, 8)
        .map((r) => String((r as Record<string, unknown>).ticker ?? ""))
        .filter(Boolean)
        .join(", ")}`
    );
  }
  return lines.join("\n") || "Market recap sparse.";
}

function formatPlayBlock(play: PlaybookPlay): string {
  // Risk/invalidation facts (risk_note + earnings_risk + gate_promoted/gate_warnings) come from
  // the same helper the deterministic fallback uses, so the LLM briefing and the no-LLM fallback
  // never disagree about which real risk signals exist on this play — see 2026-09-13 finding
  // docs/audit/findings-staging/2026-09-13-play-explainer-risk-signals-not-surfaced.md. These are
  // genuinely computed facts (not invented), so adding them to the data block only strengthens
  // the grounding-guard check downstream, it never weakens it.
  const riskLines = playRiskLines(play);
  return [
    `Rank: #${play.rank}`,
    `Ticker: ${play.ticker}`,
    `Direction: ${play.direction}`,
    `Conviction: ${play.conviction}`,
    `Play type: ${play.play_type}`,
    `Score: ${play.score}`,
    play.sector ? `Sector: ${play.sector}` : null,
    play.flow_streak_days != null ? `Flow streak: ${play.flow_streak_days}d` : null,
    play.iv_rank != null ? `IV rank: ${play.iv_rank}` : null,
    play.rr_ratio != null ? `Risk/reward ratio: ${play.rr_ratio}` : null,
    play.target_atr_multiple != null
      ? `Target distance: ${play.target_atr_multiple}x ATR14`
      : null,
    play.confirming_signals != null ? `Confirming signals: ${play.confirming_signals}` : null,
    play.exit_style === "scale_out"
      ? "Exit style: scale-out (partial at 2x, trail the runner, hard stop)"
      : null,
    play.entry_premium != null ? `Entry premium: $${play.entry_premium}/share` : null,
    play.entry_cost_per_contract != null
      ? `Cost per 1-lot: $${play.entry_cost_per_contract}`
      : null,
    `Thesis: ${play.thesis || "—"}`,
    `Key signal: ${play.key_signal || "—"}`,
    `Entry: ${play.entry_range}`,
    `Target: ${play.target}`,
    `Stop: ${play.stop}`,
    `Contract: ${play.options_play}`,
    riskLines.length ? `Risk notes:\n${riskLines.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function resolveDossierContext(
  ticker: string,
  stored?: string
): Promise<string> {
  if (stored?.trim()) return stored;
  try {
    const dossier = await fetchTickerDossier(ticker);
    const scored = dossier.scored ?? {
      ticker: dossier.ticker,
      score: 0,
      conviction: "B" as const,
      direction: "long" as const,
      flow_score: 0,
      tech_score: 0,
      pos_score: 0,
      news_score: 0,
      smart_money_score: 0,
    };
    return formatTickerDossierText(dossier, scored);
  } catch {
    return "Dossier unavailable — explain from play card and market recap only.";
  }
}

export async function generatePlayExplanation(params: {
  play: PlaybookPlay;
  editionFor: string;
  recapHeadline?: string | null;
  recapSummary?: string | null;
  marketRecap?: Record<string, unknown> | null;
  dossierContext: string;
}): Promise<string | null> {
  if (!anthropicConfigured()) {
    return buildGroundedPlayExplanationFallback({ play: params.play });
  }

  const marketRecapBlock = formatMarketRecapBlock(params.marketRecap);
  const playBlock = formatPlayBlock(params.play);

  const prompt = `Edition for session: ${params.editionFor}
${params.recapHeadline ? `Headline: ${params.recapHeadline}` : ""}
${params.recapSummary ? `Session summary: ${params.recapSummary}` : ""}

=== MARKET RECAP ===
${marketRecapBlock}

=== PLAYBOOK CARD ===
${playBlock}

=== TICKER DOSSIER (evening scan) ===
${params.dossierContext}

Write the full detailed briefing for ${params.play.ticker} ranked #${params.play.rank}.`;

  const generated = await anthropicText(prompt, 3200, SYSTEM, { timeoutMs: 45_000, maxRetries: 1 });
  const trimmed = generated?.trim();
  if (!trimmed) {
    return buildGroundedPlayExplanationFallback({
      play: params.play,
      reason: "Full Hawk Intel generation did not complete in time; this fallback uses only the grounded published play card.",
    });
  }

  // FABRICATION GUARD: the success path previously shipped Claude's briefing unchecked — only
  // an empty/failed generation fell back to the grounded card. Ground every number the briefing
  // cites against every number actually present in the SAME 3 text blocks fed into the prompt
  // (market recap + play card + dossier), extracted as free text since the dossier arrives as
  // an already-formatted string, not a structured object.
  const known = extractNumbersFromText(`${marketRecapBlock}\n${playBlock}\n${params.dossierContext}`);
  const grounding = checkNumbersGrounded(trimmed, known);
  if (!grounding.grounded) {
    console.warn(
      `[nighthawk/play-explainer] ungrounded value ${grounding.ungroundedValue} in briefing for ${params.play.ticker} — falling back to grounded play card.`
    );
    return buildGroundedPlayExplanationFallback({
      play: params.play,
      reason: "Full Hawk Intel briefing cited an unverified number; this fallback uses only the grounded published play card.",
    });
  }

  return trimmed;
}
