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

/**
 * Non-zero factor_breakdown entries, largest-magnitude first — the same real per-component
 * composite-score contributions (flow/tech/positioning/etc.) PlaybookBriefingPanel.tsx already
 * shows members as "Score components" chips, computed by scorer.ts. Same filter/sort as that
 * panel's own scoreComponents() so the narrative cites the same ranked-by-impact ordering a
 * member sees in the UI, not a second independent derivation.
 *
 * Found 2026-09-16 (live audit): "Why ranked #N" is a REQUIRED section in play-explainer.ts's
 * own system prompt, and factor_breakdown exists specifically "so the terminal can show real
 * factor bars" (types.ts's own doc comment) — but it was never included in either the LLM's
 * data block or this fallback, so "why ranked #N" could only be answered from qualitative
 * dossier prose, never the actual quantified score drivers already computed for this exact play.
 * Same defect class as the 2026-09-13 earnings_risk/gate_promoted fix above: a real,
 * already-computed signal silently absent from a section that explicitly promises to cover it.
 */
export function factorBreakdownLines(play: Pick<PlaybookPlay, "factor_breakdown">): string[] {
  const breakdown = play.factor_breakdown;
  if (!breakdown) return [];
  return Object.entries(breakdown)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([key, v]) => `${key}: ${v > 0 ? "+" : ""}${v}`);
}

export function buildGroundedPlayExplanationFallback(params: {
  play: PlaybookPlay;
  reason?: string;
}): string {
  const riskLines = playRiskLines(params.play);
  const factorLines = factorBreakdownLines(params.play);
  return [
    `**Why ranked #${params.play.rank}**`,
    params.play.thesis || params.play.key_signal || "No thesis on file.",
    factorLines.length ? `Score drivers (largest impact first): ${factorLines.join(", ")}` : null,
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
