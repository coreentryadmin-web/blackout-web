import type { PlaybookPlay } from "./types";

/**
 * Risk/invalidation lines built from already-computed play fields (earnings_risk,
 * gate_promoted/gate_warnings) that used to be silently dropped from this fallback even
 * though they're real, trusted risk signals the edition already carries — see
 * 2026-09-13 finding docs/audit/findings-staging/2026-09-13-play-explainer-risk-signals-not-surfaced.md.
 * Exported so play-explainer.ts's LLM data block can reuse the exact same facts.
 */
export function playRiskLines(play: PlaybookPlay): string[] {
  const lines: string[] = [];
  if (play.risk_note) lines.push(play.risk_note);
  if (play.earnings_risk === true) {
    lines.push("Earnings risk: this name reports earnings within the play's hold window.");
  }
  if (play.gate_promoted === true) {
    lines.push(
      "Gate-promoted: this play did not fully clear the evening publish-time sanity gates and was surfaced anyway so the edition would not publish empty — treat with extra caution."
    );
    for (const w of play.gate_warnings ?? []) lines.push(`- ${w}`);
  }
  return lines;
}

export function buildGroundedPlayExplanationFallback(params: {
  play: PlaybookPlay;
  reason?: string;
}): string {
  const riskLines = playRiskLines(params.play);
  return [
    `**Why ranked #${params.play.rank}**`,
    params.play.thesis || params.play.key_signal || "No thesis on file.",
    "",
    "**The contract & premium**",
    params.play.options_play,
    params.play.entry_premium != null
      ? `Entry premium: $${params.play.entry_premium}/share · $${params.play.entry_cost_per_contract ?? Math.round(params.play.entry_premium * 100)}/lot`
      : "Entry premium was not available on the grounded play card.",
    "",
    "**Entry · target · stop logic**",
    `Entry: ${params.play.entry_range}`,
    `Target: ${params.play.target}`,
    `Stop: ${params.play.stop}`,
    "",
    "**Risks & invalidation**",
    riskLines.length
      ? riskLines.join("\n")
      : "Use the entry, target, and stop from the published play card; no additional risk note was generated.",
    "",
    "**Bottom line:**",
    params.reason ?? "Full Hawk Intel generation is temporarily unavailable; this fallback uses only the grounded published play card.",
  ]
    .filter((line) => line != null)
    .join("\n");
}
